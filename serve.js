const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = 8001;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

function stripHtmlFromPath(pathname) {
  if (/\/index\.html$/i.test(pathname)) return pathname.replace(/\/index\.html$/i, '/');
  if (/\.html$/i.test(pathname)) return pathname.replace(/\.html$/i, '');
  return pathname;
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURI(reqUrl.pathname || '/');

  // Backward compatibility redirects for old .html URLs.
  if (/\.html$/i.test(pathname)) {
    const cleanPath = stripHtmlFromPath(pathname);
    if (cleanPath !== pathname) {
      res.writeHead(301, { Location: `${cleanPath}${reqUrl.search || ''}` });
      res.end();
      return;
    }
  }

  const ext = path.extname(pathname);
  const hasNonHtmlExt = Boolean(ext && ext.toLowerCase() !== '.html');
  const candidates = [];

  if (hasNonHtmlExt) {
    candidates.push(pathname);
  } else {
    const basePath = pathname === '/' ? '/index' : pathname.replace(/\/+$/, '');
    candidates.push(`${basePath}.html`, `${basePath}/index.html`);
  }

  let filePath = '';
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate).replace(/^(\.\.[\/\\])+/, '');
    const absolute = path.join(PUBLIC_DIR, normalized);
    if (absolute.startsWith(PUBLIC_DIR) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      filePath = absolute;
      break;
    }
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const fileExt = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[fileExt] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Static OSA portal server running at http://localhost:${PORT}`);
});
