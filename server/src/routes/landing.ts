import { Router } from "express";

const router = Router();

router.get("/", (req, res, next) => {
  // Only render the landing page when APP_NAME is set and the client
  // expects HTML (i.e. a browser visit, not an API / fetch call).
  if (!process.env.APP_NAME || !req.accepts("html")) {
    return next();
  }

  const appName = process.env.APP_NAME;
  const appDescription = process.env.APP_DESCRIPTION || "Built with Peply";

  const safe = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safe(appName)}</title>
  <meta name="description" content="${safe(appDescription)}">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      min-height:100vh;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#0f0f0f 0%,#1a1a2e 100%);
      color:#e0e0e0;
      padding:2rem;
    }
    .container{text-align:center;max-width:480px}
    .logo{
      width:72px;height:72px;
      background:linear-gradient(135deg,#FF5757,#FFB347);
      border-radius:20px;
      display:flex;align-items:center;justify-content:center;
      margin:0 auto 2rem;
      font-size:2rem;font-weight:bold;color:#fff;
    }
    h1{
      font-size:2.5rem;font-weight:700;margin-bottom:.75rem;
      background:linear-gradient(135deg,#fff,#ccc);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;
    }
    .description{font-size:1.1rem;color:#999;line-height:1.6;margin-bottom:2.5rem}
    .cta{
      display:inline-flex;align-items:center;gap:.5rem;
      padding:.875rem 2rem;
      background:linear-gradient(135deg,#FF5757,#FFB347);
      color:#fff;font-size:1rem;font-weight:600;
      border-radius:12px;text-decoration:none;
      transition:transform .2s,box-shadow .2s;
    }
    .cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,87,87,.3)}
    .footer{margin-top:3rem;font-size:.8rem;color:#555}
    .footer a{color:#FF5757;text-decoration:none}
    .footer a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">${safe(appName.charAt(0))}</div>
    <h1>${safe(appName)}</h1>
    <p class="description">${safe(appDescription)}</p>
    <a href="/app" class="cta">
      Open App
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>
  <p class="footer">Built with <a href="https://peply.dev" target="_blank" rel="noopener">Peply</a></p>
</body>
</html>`);
});

export default router;
