import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY;

// Start in mock mode first so you can test Render, Namecheap, and GPT Actions.
// Later, change TRANSKRIBUS_MODE to "live" and connect the real Transkribus API calls.
const TRANSKRIBUS_MODE = process.env.TRANSKRIBUS_MODE || "mock";

const jobs = new Map();

function requireApiKey(req, res, next) {
  const incomingKey = req.header("X-API-Key");

  if (!BRIDGE_API_KEY) {
    return res.status(500).json({
      error: "Bridge API key is not configured on the server."
    });
  }

  if (incomingKey !== BRIDGE_API_KEY) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    message: job.message,
    documentId: job.documentId,
    collectionId: job.collectionId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function completeMockJob(jobId) {
  const job = jobs.get(jobId);

  if (!job || job.status !== "queued") {
    return;
  }

  const now = new Date().toISOString();

  job.status = "completed";
  job.message = "Mock recognition completed. Replace this with live Transkribus recognition.";
  job.updatedAt = now;
  job.documentId = `mock_doc_${jobId.slice(-8)}`;
  job.text = [
    "Mock Transkribus transcript.",
    "",
    "This is where the readable handwriting transcription will appear.",
    "",
    "Example genealogy-style output:",
    "John Stokes, son of William Stokes and Mary Ann Stokes, was baptized on 14 March 1842 in the parish of St. Mary.",
    "Witnesses: Thomas Green and Elizabeth Carter."
  ].join("\n");

  job.pages = [
    {
      pageNumber: 1,
      text: job.text,
      confidence: 0.95
    }
  ];

  jobs.set(jobId, job);
}

/*
  LIVE TRANSKRIBUS ADAPTER PLACEHOLDER

  This is where the real Transkribus code goes.

  The bridge should eventually:
  1. Authenticate with Transkribus.
  2. Upload or import the sourceUrl image/PDF.
  3. Start handwriting recognition using your collection/model.
  4. Store the Transkribus job ID.
  5. Poll Transkribus for status.
  6. Fetch the transcript text when complete.

  Keep all Transkribus secrets in Render environment variables, never in your GPT action.
*/
async function startLiveTranskribusRecognition(job) {
  throw new Error(
    "Live Transkribus mode is not implemented yet. Use TRANSKRIBUS_MODE=mock for testing."
  );
}

async function getLiveTranskribusJobStatus(job) {
  throw new Error(
    "Live Transkribus status lookup is not implemented yet."
  );
}

async function getLiveTranskribusText(job) {
  throw new Error(
    "Live Transkribus transcript retrieval is not implemented yet."
  );
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Stoked4Stokes Transkribus Genealogy Bridge",
    message: "Use /api/health for the GPT Action health check."
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Stoked4Stokes Transkribus Genealogy Bridge",
    mode: TRANSKRIBUS_MODE
  });
});

app.post("/api/transkribus/recognize", requireApiKey, async (req, res) => {
  try {
    const {
      sourceUrl,
      title,
      collectionId,
      modelId,
      language,
      notes
    } = req.body || {};

    if (!sourceUrl || !isValidHttpUrl(sourceUrl)) {
      return res.status(400).json({
        error: "sourceUrl is required and must be a valid http or https URL."
      });
    }

    const now = new Date().toISOString();
    const jobId = `job_${crypto.randomUUID()}`;

    const job = {
      jobId,
      status: "queued",
      message: "Recognition job queued.",
      sourceUrl,
      title: title || "Untitled genealogy record",
      collectionId: collectionId || process.env.TRANSKRIBUS_COLLECTION_ID || null,
      modelId: modelId || process.env.TRANSKRIBUS_MODEL_ID || null,
      language: language || null,
      notes: notes || null,
      documentId: null,
      createdAt: now,
      updatedAt: now,
      text: null,
      pages: []
    };

    jobs.set(jobId, job);

    if (TRANSKRIBUS_MODE === "mock") {
      setTimeout(() => completeMockJob(jobId), 1500);

      return res.status(202).json({
        ...publicJob(job),
        message: "Mock recognition job accepted. Check status in a few seconds."
      });
    }

    await startLiveTranskribusRecognition(job);

    return res.status(202).json(publicJob(job));
  } catch (error) {
    return res.status(500).json({
      error: "Failed to start handwriting recognition.",
      details: error.message
    });
  }
});

app.get("/api/transkribus/jobs/:jobId", requireApiKey, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        error: "Job not found."
      });
    }

    if (TRANSKRIBUS_MODE === "live") {
      await getLiveTranskribusJobStatus(job);
    }

    return res.json(publicJob(job));
  } catch (error) {
    return res.status(500).json({
      error: "Failed to get recognition job status.",
      details: error.message
    });
  }
});

app.get("/api/transkribus/jobs/:jobId/text", requireApiKey, async (req, res) => {
  try {
    const { jobId } = req.params;
    const format = req.query.format || "text";
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        error: "Job not found."
      });
    }

    if (job.status !== "completed") {
      return res.status(409).json({
        error: "Recognition job is not completed yet.",
        job: publicJob(job)
      });
    }

    if (TRANSKRIBUS_MODE === "live") {
      await getLiveTranskribusText(job);
    }

    return res.json({
      jobId: job.jobId,
      documentId: job.documentId,
      collectionId: job.collectionId,
      format,
      text: job.text,
      pages: job.pages,
      sourceUrl: job.sourceUrl
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to get recognized text.",
      details: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not found"
  });
});

app.listen(PORT, () => {
  console.log(`Bridge API running on port ${PORT}`);
});
