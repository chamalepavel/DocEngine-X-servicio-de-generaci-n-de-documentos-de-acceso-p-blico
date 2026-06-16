const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");

const templatesDir = path.join(__dirname, "templates");
const cache = new Map();

Handlebars.registerHelper("inc", function (value) {
  return parseInt(value) + 1;
});

function loadTemplate(type) {
  if (cache.has(type)) return cache.get(type);

  const file = path.join(templatesDir, `${type}.hbs`);
  if (!fs.existsSync(file)) throw new Error(`Plantilla no encontrada: ${type}.hbs`);

  const compiled = Handlebars.compile(fs.readFileSync(file, "utf-8"));
  cache.set(type, compiled);
  return compiled;
}

async function generatePdf(templateType, payload) {
  const template = loadTemplate(templateType);
  const html = template(payload);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
      timeout: 30000,
    });

    return pdf;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generatePdf };
