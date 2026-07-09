pub fn default_presets() -> Vec<(String, Option<String>, String)> {
    vec![
        (
            "APT Update & Upgrade".into(),
            Some("Update package lists and upgrade all packages".into()),
            r#"# APT Update & Upgrade
remote: sudo apt-get update -y
remote: sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
"#
            .into(),
        ),
        (
            "Restart Service".into(),
            Some("Restart a systemd service (edit command before run)".into()),
            r#"# Restart Service
remote: sudo systemctl restart nginx
remote: sudo systemctl status nginx --no-pager
"#
            .into(),
        ),
        (
            "Reboot Server".into(),
            Some("Gracefully reboot the server".into()),
            r#"# Reboot Server
remote: sudo shutdown -r +1 'Reboot scheduled by BriskBastion'
"#
            .into(),
        ),
        (
            "Docker Prune".into(),
            Some("Remove unused Docker containers, networks, and images".into()),
            r#"# Docker Prune
remote: docker system prune -af --volumes
"#
            .into(),
        ),
        (
            "Deploy static site".into(),
            Some("Build locally, sync dist, restart pm2".into()),
            r#"# Deploy static site
local: npm run build
sync: ./dist -> /var/www/my-site
remote: pm2 restart app
"#
            .into(),
        ),
    ]
}
