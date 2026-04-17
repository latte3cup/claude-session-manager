use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::RootCertStore;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Returns the certs directory path: ~/.claude-session-manager/certs/
pub fn certs_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(format!("{}\\.claude-session-manager\\certs", home))
}

/// Check if mTLS is configured (certs directory with required files exists)
pub fn is_mtls_configured() -> bool {
    let dir = certs_dir();
    dir.join("ca.crt").exists()
        && dir.join("server.crt").exists()
        && dir.join("server.key").exists()
}

/// Load certificates from PEM file
fn load_certs(path: &Path) -> Result<Vec<CertificateDer<'static>>, Box<dyn std::error::Error + Send + Sync>> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let certs = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(certs)
}

/// Load private key from PEM file
fn load_private_key(path: &Path) -> Result<PrivateKeyDer<'static>, Box<dyn std::error::Error + Send + Sync>> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);

    // Try PKCS8 first, then RSA, then EC
    for item in rustls_pemfile::read_all(&mut reader) {
        match item? {
            rustls_pemfile::Item::Pkcs8Key(key) => return Ok(PrivateKeyDer::Pkcs8(key)),
            rustls_pemfile::Item::Pkcs1Key(key) => return Ok(PrivateKeyDer::Pkcs1(key)),
            rustls_pemfile::Item::Sec1Key(key) => return Ok(PrivateKeyDer::Sec1(key)),
            _ => continue,
        }
    }
    Err("No private key found in PEM file".into())
}

/// Load revoked CNs from revoked.txt
fn load_revoked_cns(dir: &Path) -> Vec<String> {
    let path = dir.join("revoked.txt");
    if let Ok(content) = fs::read_to_string(path) {
        content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect()
    } else {
        Vec::new()
    }
}

/// Build rustls ServerConfig with mTLS (client certificate verification)
pub fn build_tls_config() -> Result<rustls::ServerConfig, Box<dyn std::error::Error + Send + Sync>> {
    let dir = certs_dir();

    // Load CA certificate for client verification
    let ca_certs = load_certs(&dir.join("ca.crt"))?;
    let mut root_store = RootCertStore::empty();
    for cert in ca_certs {
        root_store.add(cert)?;
    }

    // Build client verifier (require client cert signed by our CA)
    let client_verifier = WebPkiClientVerifier::builder(Arc::new(root_store))
        .build()?;

    // Load server cert and key
    let server_certs = load_certs(&dir.join("server.crt"))?;
    let server_key = load_private_key(&dir.join("server.key"))?;

    let config = rustls::ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_single_cert(server_certs, server_key)?;

    let _revoked = load_revoked_cns(&dir);
    // Note: CRL-based revocation is checked in the WebSocket handler layer
    // by extracting the CN from the client cert and comparing against revoked.txt

    eprintln!(
        "[tls] mTLS configured with CA from {}",
        dir.join("ca.crt").display()
    );

    Ok(config)
}

/// Get the list of revoked CNs (called per-connection for CRL check)
#[allow(dead_code)]
pub fn get_revoked_cns() -> Vec<String> {
    load_revoked_cns(&certs_dir())
}
