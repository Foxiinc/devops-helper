use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CveInfo {
    pub id: String,
    pub severity: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageUpdate {
    pub name: String,
    pub installed: String,
    pub available: String,
    pub size: Option<String>,
    #[serde(default)]
    pub cves: Vec<CveInfo>,
    pub max_severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatesReport {
    pub os: super::distro::OsInfo,
    pub packages: Vec<PackageUpdate>,
    pub checked_at: DateTime<Utc>,
}
