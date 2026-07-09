use std::time::Duration;

use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use crate::updates::types::{CveInfo, PackageUpdate};

const OSV_BATCH_URL: &str = "https://api.osv.dev/v1/querybatch";
const CACHE_TTL_HOURS: i64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedOsvPayload {
    cves: Vec<CveInfo>,
    max_severity: Option<String>,
}

#[derive(Debug, Serialize)]
struct OsvBatchRequest {
    queries: Vec<OsvQuery>,
}

#[derive(Debug, Serialize)]
struct OsvQuery {
    package: OsvPackage,
    version: String,
}

#[derive(Debug, Serialize)]
struct OsvPackage {
    name: String,
    ecosystem: String,
}

#[derive(Debug, Deserialize)]
struct OsvBatchResponse {
    results: Vec<OsvQueryResult>,
}

#[derive(Debug, Deserialize)]
struct OsvQueryResult {
    vulns: Option<Vec<OsvVuln>>,
}

#[derive(Debug, Deserialize)]
struct OsvVuln {
    id: String,
    summary: Option<String>,
    #[serde(default)]
    database_specific: serde_json::Value,
    #[serde(default)]
    severity: Vec<OsvSeverity>,
}

#[derive(Debug, Deserialize)]
struct OsvSeverity {
    #[serde(rename = "type")]
    severity_type: String,
    score: String,
}

pub struct OsvClient {
    http: Client,
}

impl OsvClient {
    pub fn new() -> CoreResult<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|e| CoreError::Other(e.to_string()))?,
        })
    }

    /// Sync: apply cached CVE data and return packages still needing OSV lookup.
    pub fn apply_cache(
        db: &Database,
        ecosystem: &str,
        packages: &mut [PackageUpdate],
    ) -> CoreResult<Vec<(usize, String, String)>> {
        let mut pending = Vec::new();

        for idx in 0..packages.len() {
            let version = if !packages[idx].installed.is_empty() {
                packages[idx].installed.clone()
            } else {
                packages[idx].available.clone()
            };
            if version.is_empty() {
                continue;
            }

            let cache_key = format!("{ecosystem}:{}:{version}", packages[idx].name);
            if let Some((json, fetched_at)) = db.get_osv_cache(&cache_key)? {
                if Utc::now().signed_duration_since(fetched_at).num_hours() < CACHE_TTL_HOURS {
                    if let Ok(cached) = serde_json::from_str::<CachedOsvPayload>(&json) {
                        packages[idx].cves = cached.cves;
                        packages[idx].max_severity = cached.max_severity;
                        continue;
                    }
                } else {
                    db.delete_osv_cache(&cache_key)?;
                }
            }

            pending.push((idx, packages[idx].name.clone(), version));
        }

        Ok(pending)
    }

    /// Async HTTP only — no database access.
    pub async fn fetch_pending(
        &self,
        ecosystem: &str,
        pending: Vec<(usize, String, String)>,
    ) -> CoreResult<Vec<(usize, String, String, Vec<CveInfo>, Option<String>)>> {
        let mut results = Vec::new();

        for chunk in pending.chunks(50) {
            let queries: Vec<OsvQuery> = chunk
                .iter()
                .map(|(_, name, version)| OsvQuery {
                    package: OsvPackage {
                        name: name.clone(),
                        ecosystem: ecosystem.to_string(),
                    },
                    version: version.clone(),
                })
                .collect();

            let response = self
                .http
                .post(OSV_BATCH_URL)
                .json(&OsvBatchRequest { queries })
                .send()
                .await
                .map_err(|e| CoreError::Other(format!("OSV request failed: {e}")))?;

            if !response.status().is_success() {
                return Err(CoreError::Other(format!(
                    "OSV API returned {}",
                    response.status()
                )));
            }

            let body: OsvBatchResponse = response
                .json()
                .await
                .map_err(|e| CoreError::Other(format!("OSV parse failed: {e}")))?;

            for ((idx, name, version), result) in chunk.iter().zip(body.results.into_iter()) {
                let cves = vulns_to_cves(result.vulns.unwrap_or_default());
                let severity = max_severity(&cves);
                results.push((*idx, name.clone(), version.clone(), cves, severity));
            }
        }

        Ok(results)
    }

    /// Sync: persist OSV results to cache and packages.
    pub fn save_results(
        db: &Database,
        ecosystem: &str,
        results: &[(usize, String, String, Vec<CveInfo>, Option<String>)],
        packages: &mut [PackageUpdate],
    ) -> CoreResult<()> {
        for (idx, name, version, cves, max_severity) in results {
            let cache_key = format!("{ecosystem}:{name}:{version}");
            let payload = CachedOsvPayload {
                cves: cves.clone(),
                max_severity: max_severity.clone(),
            };
            db.set_osv_cache(&cache_key, &serde_json::to_string(&payload)?)?;
            packages[*idx].cves = cves.clone();
            packages[*idx].max_severity = max_severity.clone();
        }
        Ok(())
    }
}

fn vulns_to_cves(vulns: Vec<OsvVuln>) -> Vec<CveInfo> {
    vulns
        .into_iter()
        .map(|v| {
            let severity = v
                .severity
                .iter()
                .find(|s| s.severity_type == "CVSS_V3")
                .map(|s| severity_label(&s.score))
                .or_else(|| {
                    v.database_specific
                        .get("severity")
                        .and_then(|s| s.as_str())
                        .map(str::to_string)
                });

            CveInfo {
                id: v.id,
                summary: v.summary,
                severity,
            }
        })
        .collect()
}

fn severity_label(score: &str) -> String {
    if let Ok(value) = score.parse::<f32>() {
        return match value {
            s if s >= 9.0 => "CRITICAL".into(),
            s if s >= 7.0 => "HIGH".into(),
            s if s >= 4.0 => "MEDIUM".into(),
            _ => "LOW".into(),
        };
    }
    "UNKNOWN".into()
}

fn max_severity(cves: &[CveInfo]) -> Option<String> {
    let rank = |s: &str| match s {
        "CRITICAL" => 4,
        "HIGH" => 3,
        "MEDIUM" => 2,
        "LOW" => 1,
        _ => 0,
    };

    cves.iter()
        .filter_map(|c| c.severity.as_deref())
        .max_by_key(|s| rank(s))
        .map(str::to_string)
}

pub fn cache_ttl_hours() -> i64 {
    CACHE_TTL_HOURS
}
