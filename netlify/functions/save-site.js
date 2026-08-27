// netlify/functions/save-site.js
//
// Receives the full updated site HTML from the admin panel and commits it
// to GitHub as index.html. Netlify is connected to that GitHub repo, so
// every commit triggers an automatic rebuild + deploy — no manual
// download/upload needed anymore.
//
// Required environment variables (set these in Netlify: Site settings →
// Environment variables):
//   GITHUB_TOKEN      - a GitHub Personal Access Token with "repo" scope
//   GITHUB_OWNER      - your GitHub username (or org) that owns the repo
//   GITHUB_REPO       - the repository name (e.g. "playa-avellanas-site")
//   GITHUB_BRANCH     - branch to commit to (usually "main")
//   GITHUB_FILE_PATH  - path of the file in the repo (usually "index.html")
//   ADMIN_PASSWORD    - same password used to unlock the admin panel

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { password, html } = payload;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Contraseña incorrecta" }) };
  }

  if (!html || typeof html !== "string" || html.length < 1000) {
    return { statusCode: 400, body: JSON.stringify({ error: "Contenido inválido o vacío" }) };
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const path = process.env.GITHUB_FILE_PATH || "index.html";
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Faltan variables de entorno en Netlify (GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN)." })
    };
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const ghHeaders = {
    Authorization: `token ${token}`,
    "User-Agent": "playa-avellanas-admin-panel",
    Accept: "application/vnd.github+json"
  };

  try {
    // 1) Get the current file's SHA (GitHub requires this to update an existing file)
    let sha;
    const getResp = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (getResp.status === 200) {
      const getJson = await getResp.json();
      sha = getJson.sha;
    } else if (getResp.status !== 404) {
      const errText = await getResp.text();
      return { statusCode: 502, body: JSON.stringify({ error: "No se pudo leer el archivo actual en GitHub", detail: errText }) };
    }

    // 2) Create or update the file with the new content
    const contentBase64 = Buffer.from(html, "utf-8").toString("base64");
    const putResp = await fetch(apiBase, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Actualización de propiedades — ${new Date().toISOString()}`,
        content: contentBase64,
        branch,
        ...(sha ? { sha } : {})
      })
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return { statusCode: 502, body: JSON.stringify({ error: "GitHub rechazó el commit", detail: errText }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Publicado. Netlify va a desplegar los cambios en 30–90 segundos." })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Error inesperado", detail: String(err) }) };
  }
};
