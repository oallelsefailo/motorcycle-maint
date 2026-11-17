const path = require("path");
const fs = require("fs");
const express = require("express");
const PDFDocument = require("pdfkit");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "entries.json");

// Oil analysis PDFs live here; the folder itself is the source of truth.
const FILES_DIR = path.join(__dirname, "files");
const MAX_REPORT_BYTES = 10 * 1024 * 1024; // 10MB
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers ----------
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ entries: [], notes: "" }, null, 2),
      "utf-8",
    );
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return { entries: parsed, notes: "" };
  }

  return {
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isValidISODate(dateStr) {
  return typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function formatPdfDate(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate))
    return isoDate;
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${mm}/${dd}/${yyyy}`;
}

function normalizeCost(value) {
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function normalizeMileage(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function sortChronological(entries) {
  return entries.slice().sort((a, b) => {
    const ad = a.date || "";
    const bd = b.date || "";
    if (ad < bd) return -1;
    if (ad > bd) return 1;
    return (a.id || "").localeCompare(b.id || "");
  });
}

// ---------- API ----------
app.get("/api/data", (req, res) => {
  const data = readData();
  data.entries = sortChronological(data.entries);
  res.json(data);
});

app.get("/api/entries", (req, res) => {
  const data = readData();
  res.json(sortChronological(data.entries));
});

app.post("/api/entries", (req, res) => {
  const { date, maintenance, mileage, cost } = req.body || {};

  if (!isValidISODate(date)) {
    return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
  }

  if (typeof maintenance !== "string" || maintenance.trim().length === 0) {
    return res.status(400).json({ error: "Maintenance is required." });
  }

  const mileageVal = normalizeMileage(mileage);
  if (
    mileage !== "" &&
    mileage !== null &&
    mileage !== undefined &&
    mileageVal === null
  ) {
    return res
      .status(400)
      .json({ error: "Mileage must be a non-negative number (or blank)." });
  }

  const costVal = normalizeCost(cost);
  if (costVal === null) {
    return res.status(400).json({ error: "Cost must be a number." });
  }

  const data = readData();
  const newEntry = {
    id: makeId(),
    date,
    maintenance: maintenance.trim(),
    cost: costVal,
  };

  if (mileageVal !== null) {
    newEntry.mileage = mileageVal;
  }

  data.entries.push(newEntry);
  writeData(data);

  data.entries = sortChronological(data.entries);
  res.status(201).json(data);
});

app.put("/api/entries/:id", (req, res) => {
  const { id } = req.params;
  const { date, maintenance, mileage, cost } = req.body || {};

  if (!isValidISODate(date)) {
    return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
  }

  if (typeof maintenance !== "string" || maintenance.trim().length === 0) {
    return res.status(400).json({ error: "Maintenance is required." });
  }

  const mileageVal = normalizeMileage(mileage);
  if (
    mileage !== "" &&
    mileage !== null &&
    mileage !== undefined &&
    mileageVal === null
  ) {
    return res
      .status(400)
      .json({ error: "Mileage must be a non-negative number (or blank)." });
  }

  const costVal = normalizeCost(cost);
  if (costVal === null) {
    return res.status(400).json({ error: "Cost must be a number." });
  }

  const data = readData();
  const idx = data.entries.findIndex((e) => e.id === id);
  if (idx === -1) return res.status(404).json({ error: "Entry not found." });

  const updatedEntry = {
    ...data.entries[idx],
    date,
    maintenance: maintenance.trim(),
    cost: costVal,
  };

  if (mileageVal !== null) {
    updatedEntry.mileage = mileageVal;
  } else {
    delete updatedEntry.mileage;
  }

  data.entries[idx] = updatedEntry;

  writeData(data);
  data.entries = sortChronological(data.entries);
  res.json(data);
});

app.delete("/api/entries/:id", (req, res) => {
  const { id } = req.params;
  const data = readData();
  const next = data.entries.filter((e) => e.id !== id);

  if (next.length === data.entries.length) {
    return res.status(404).json({ error: "Entry not found." });
  }

  data.entries = next;
  writeData(data);
  data.entries = sortChronological(data.entries);
  res.json(data);
});

app.put("/api/notes", (req, res) => {
  const { notes } = req.body || {};

  if (typeof notes !== "string") {
    return res.status(400).json({ error: "Notes must be a string." });
  }

  const data = readData();
  data.notes = notes;
  writeData(data);

  res.json({ success: true });
});

// ---------- Oil analysis reports (PDFs in /files) ----------
const SAFE_PDF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i;

// Resolve a client-supplied filename to a path inside FILES_DIR, or null.
function resolveReportPath(name) {
  if (typeof name !== "string" || !SAFE_PDF_NAME.test(name)) return null;
  if (path.basename(name) !== name) return null;
  const full = path.resolve(FILES_DIR, name);
  if (path.dirname(full) !== path.resolve(FILES_DIR)) return null;
  return full;
}

// Turn an uploaded name into a safe, unique filename in FILES_DIR.
function makeSafeReportName(originalName) {
  const base = path
    .basename(String(originalName || ""))
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/-+/g, "-")
    .replace(/[-.]+$/, "")
    .slice(0, 100);
  const stem = base || `oil-report-${Date.now()}`;

  let candidate = `${stem}.pdf`;
  let n = 1;
  while (fs.existsSync(path.join(FILES_DIR, candidate))) {
    candidate = `${stem}-${n++}.pdf`;
  }
  return candidate;
}

const reportUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, FILES_DIR),
    filename: (req, file, cb) => cb(null, makeSafeReportName(file.originalname)),
  }),
  limits: { fileSize: MAX_REPORT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const isPdf = /\.pdf$/i.test(file.originalname || "");
    if (!isPdf) return cb(new Error("Only .pdf files are allowed."));
    cb(null, true);
  },
}).single("file");

app.get("/api/oil-reports", (req, res) => {
  try {
    const reports = fs
      .readdirSync(FILES_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && SAFE_PDF_NAME.test(d.name))
      .map((d) => {
        const stat = fs.statSync(path.join(FILES_DIR, d.name));
        return {
          filename: d.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified)); // newest first
    res.json(reports);
  } catch (err) {
    console.error("Failed to list oil reports:", err);
    res.status(500).json({ error: "Failed to list oil reports." });
  }
});

app.post("/api/oil-reports", (req, res) => {
  reportUpload(req, res, (err) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large (max 10MB)."
          : err.message || "Upload failed.";
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Verify it's really a PDF (magic bytes), not just named .pdf
    const fullPath = req.file.path;
    try {
      const fd = fs.openSync(fullPath, "r");
      const head = Buffer.alloc(5);
      fs.readSync(fd, head, 0, 5, 0);
      fs.closeSync(fd);
      if (head.toString("latin1") !== "%PDF-") {
        fs.unlinkSync(fullPath);
        return res.status(400).json({ error: "File is not a valid PDF." });
      }
    } catch (e) {
      fs.rmSync(fullPath, { force: true });
      return res.status(500).json({ error: "Failed to save file." });
    }

    const stat = fs.statSync(fullPath);
    res.status(201).json({
      filename: req.file.filename,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    });
  });
});

app.get("/api/oil-reports/:filename", (req, res) => {
  const full = resolveReportPath(req.params.filename);
  if (!full || !fs.existsSync(full)) {
    return res.status(404).json({ error: "Report not found." });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${path.basename(full)}"`,
  );
  res.sendFile(full);
});

app.delete("/api/oil-reports/:filename", (req, res) => {
  const full = resolveReportPath(req.params.filename);
  if (!full || !fs.existsSync(full)) {
    return res.status(404).json({ error: "Report not found." });
  }
  try {
    fs.unlinkSync(full);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete oil report:", err);
    res.status(500).json({ error: "Failed to delete report." });
  }
});

// ---------- PDF download ----------
app.get("/api/entries.pdf", (req, res) => {
  const data = readData();
  const entries = sortChronological(data.entries);
  const notes = data.notes || "";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="zx10r-maintenance.pdf"',
  );

  const doc = new PDFDocument({ margin: 40, size: "LETTER" });
  doc.pipe(res);

  // ----- Header: logo + title on same line -----
  const logoPath = path.join(__dirname, "public", "kawi-logo.png");

  const headerTop = doc.page.margins.top;
  const headerLeft = doc.page.margins.left;
  const logoHeight = 36;
  const logoWidth = 80;

  let titleStartX = headerLeft;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, headerLeft, headerTop, {
      height: logoHeight,
    });

    titleStartX = headerLeft + logoWidth + 12;
  }

  doc.y = headerTop;

  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(
      "2024 ZX10R (KRT) Maintenance / Mods Tracker",
      titleStartX,
      headerTop,
      {
        width: doc.page.width - doc.page.margins.right - titleStartX,
        align: "left",
      },
    );

  doc
    .moveDown(0.4)
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#666")
    .text(`Generated: ${new Date().toLocaleString()}`, titleStartX);

  doc.fillColor("black");

  doc.y = headerTop + logoHeight + 18;

  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colDate = 110;
  const colMileage = 90;
  const colCost = 90;
  const colMaint = pageWidth - colDate - colMileage - colCost;

  const startX = doc.page.margins.left;
  let y = doc.y;

  function drawRow({ date, maintenance, mileage, cost }, isHeader = false) {
    const rowPadY = 6;
    const rowHeight = isHeader ? 18 : 20;

    if (y + rowHeight + 10 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawRow(
        {
          date: "Date",
          maintenance: "Maintenance / Mod",
          mileage: "Mileage",
          cost: "Cost",
        },
        true,
      );
    }

    if (isHeader) {
      doc.rect(startX, y, pageWidth, rowHeight).fill("#eaeaea");
      doc.fillColor("black").fontSize(10).font("Helvetica-Bold");
    } else {
      doc.rect(startX, y, pageWidth, rowHeight).strokeColor("#dddddd").stroke();
      doc.fillColor("black").fontSize(10).font("Helvetica");
    }

    doc.text(
      String(isHeader ? date : formatPdfDate(date)),
      startX + 6,
      y + rowPadY,
      {
        width: colDate - 12,
      },
    );

    doc.text(String(maintenance), startX + colDate + 6, y + rowPadY, {
      width: colMaint - 12,
      ellipsis: true,
    });

    const mileText = isHeader
      ? String(mileage)
      : Number.isFinite(Number(mileage))
        ? String(Math.round(Number(mileage)))
        : "";
    doc.text(mileText, startX + colDate + colMaint + 6, y + rowPadY, {
      width: colMileage - 12,
      align: "right",
    });

    const costX = startX + colDate + colMaint + colMileage + 6;
    if (isHeader) {
      doc.text(String(cost), costX, y + rowPadY, {
        width: colCost - 12,
        align: "right",
      });
    } else {
      const costVal = normalizeCost(cost);
      const safeCost = costVal === null ? 0 : costVal;
      doc.text(`$${safeCost.toFixed(2)}`, costX, y + rowPadY, {
        width: colCost - 12,
        align: "right",
      });
    }

    y += rowHeight;
  }

  drawRow(
    {
      date: "Date",
      maintenance: "Maintenance / Mod",
      mileage: "Mileage",
      cost: "Cost",
    },
    true,
  );

  let total = 0;
  for (const e of entries) {
    const c = normalizeCost(e.cost);
    total += c === null ? 0 : c;
    drawRow(e, false);
  }

  doc.moveDown(1);
  const rightEdge = startX + pageWidth;
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`Total Spent: $${total.toFixed(2)}`, startX, doc.y, {
      width: pageWidth,
      align: "right",
      lineBreak: false,
    });

  if (notes.trim()) {
    doc.moveDown(3);

    if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
      doc.addPage();
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("black")
      .text("Additional Mods:", startX);

    doc.moveDown(0.5);

    const noteLines = notes
      .trim()
      .split("\n")
      .filter((line) => line.trim());
    doc.font("Helvetica").fontSize(10).fillColor("#333");

    for (const line of noteLines) {
      if (line.trim()) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
        }
        doc.text(`• ${line.trim()}`, startX, doc.y, {
          width: pageWidth,
          lineGap: 3,
        });
      }
    }
  }

  doc.end();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Motorcycle maint tracker running on http://localhost:${PORT}`);
});
