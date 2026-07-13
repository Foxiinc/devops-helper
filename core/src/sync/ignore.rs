use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct IgnoreRules {
    patterns: Vec<String>,
}

impl IgnoreRules {
    pub fn build(base: &Path, extra: &[String], use_gitignore: bool) -> Self {
        let mut patterns = Vec::new();
        for p in extra {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                patterns.push(trimmed.to_string());
            }
        }
        if use_gitignore {
            patterns.extend(load_gitignore(base));
        }
        Self { patterns }
    }

    pub fn is_ignored(&self, relative: &str) -> bool {
        let rel = relative.replace('\\', "/");
        let rel = rel.trim_start_matches("./");
        self.patterns.iter().any(|p| matches_pattern(rel, p))
    }

}

fn load_gitignore(base: &Path) -> Vec<String> {
    let path = base.join(".gitignore");
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.trim_start_matches('/').to_string())
        .collect()
}

fn matches_pattern(path: &str, pattern: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return false;
    }

    if pattern.contains('*') {
        return glob_match(path, pattern);
    }

    let pattern = pattern.trim_end_matches('/');
    if pattern.contains('/') {
        return path == pattern || path.starts_with(&format!("{pattern}/"));
    }

    path.split('/').any(|seg| seg == pattern)
        || path.starts_with(&format!("{pattern}/"))
        || path == pattern
}

fn glob_match(path: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return false;
    }
    if let Some(rest) = pattern.strip_prefix("*/") {
        return path.ends_with(rest)
            || path.contains(&format!("/{rest}"))
            || path.split('/').any(|seg| seg == rest);
    }
    if let Some(rest) = pattern.strip_suffix("/*") {
        return path == rest || path.starts_with(&format!("{rest}/"));
    }
    if pattern.contains('*') {
        let parts: Vec<&str> = pattern.split('*').collect();
        if parts.len() == 2 {
            return path.starts_with(parts[0]) && path.ends_with(parts[1]);
        }
    }
    path == pattern
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_node_modules_segment() {
        let rules = IgnoreRules {
            patterns: vec!["node_modules".into()],
        };
        assert!(rules.is_ignored("node_modules/react/index.js"));
        assert!(rules.is_ignored("src/node_modules/x"));
        assert!(!rules.is_ignored("src/main.rs"));
    }

    #[test]
    fn ignores_git_dir() {
        let rules = IgnoreRules {
            patterns: vec![".git".into()],
        };
        assert!(rules.is_ignored(".git/config"));
        assert!(!rules.is_ignored("src/.gitkeep"));
    }
}
