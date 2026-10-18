const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const memoryCalls = [];
const stages = ["opening", "purpose", "permission", "business", "need", "objection", "next_step", "close"];
const aiEnabled = Boolean(process.env.LLM_API_KEY);

const sendError = (res, status, message) => res.status(status).json({ error: message });

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "call-compass-api", storage: supabase ? "supabase" : "memory", ai: aiEnabled ? "enabled" : "disabled" });
});

app.post("/calls", async (req, res) => {
  const { prospectName, company, callerName = "Me", context = "" } = req.body || {};
  if (!prospectName || !company) return sendError(res, 400, "prospectName and company are required");
  const call = {
    id: crypto.randomUUID(),
    prospect_name: prospectName.trim(),
    company: company.trim(),
    caller_name: callerName.trim(),
    context: context.trim(),
    current_stage: "opening",
    status: "active",
    started_at: new Date().toISOString(),
    ended_at: null,
    outcome: null,
    stage_results: []
  };
  if (supabase) {
    const { stage_results, ...row } = call;
    const { data, error } = await supabase.from("calls").insert(row).select().single();
    if (error) return sendError(res, 502, error.message);
    return res.status(201).json({ ...data, stage_results });
  }
  memoryCalls.unshift(call);
  res.status(201).json(call);
});

app.post("/calls/:id/stages", async (req, res) => {
  const { stage, result, prospectWords = "" } = req.body || {};
  if (!stages.includes(stage) || !result) return sendError(res, 400, "A valid stage and result are required");
  const stageResult = {
    id: crypto.randomUUID(),
    call_id: req.params.id,
    stage,
    result,
    prospect_words: prospectWords.trim(),
    recorded_at: new Date().toISOString()
  };
  if (supabase) {
    const { error: resultError } = await supabase.from("stage_results").insert(stageResult);
    if (resultError) return sendError(res, 502, resultError.message);
    const { error: callError } = await supabase.from("calls").update({ current_stage: stage }).eq("id", req.params.id);
    if (callError) return sendError(res, 502, callError.message);
    return res.status(201).json(stageResult);
  }
  const call = memoryCalls.find((item) => item.id === req.params.id);
  if (!call) return sendError(res, 404, "Call not found");
  call.stage_results.push(stageResult);
  call.current_stage = stage;
  res.status(201).json(stageResult);
});

app.post("/calls/:id/close", async (req, res) => {
  const { outcome } = req.body || {};
  if (!outcome) return sendError(res, 400, "outcome is required");
  const updates = { status: "closed", outcome, ended_at: new Date().toISOString() };
  if (supabase) {
    const { data, error } = await supabase.from("calls").update(updates).eq("id", req.params.id).select().single();
    if (error) return sendError(res, 502, error.message);
    return res.json(data);
  }
  const call = memoryCalls.find((item) => item.id === req.params.id);
  if (!call) return sendError(res, 404, "Call not found");
  Object.assign(call, updates);
  res.json(call);
});

async function buildDebrief(call) {
  const stageNotes = (call.stage_results || []).map((item) => `Stage ${item.stage}: ${item.result}. Prospect words: ${item.prospect_words || "n/a"}`).join("\n");
  const fallback = `Prospect ${call.prospect_name} at ${call.company} reached ${call.current_stage}. Outcome: ${call.outcome || "not set"}.`;
  if (!aiEnabled) return { model: "fallback", summary: fallback };

  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Write a concise post-call debrief for a cold-call note-taking product. Do not invent facts. Return 3 bullets: what happened, what the prospect seemed to care about, and the best next step." },
        { role: "user", content: `Prospect: ${call.prospect_name} at ${call.company}\nOutcome: ${call.outcome || "not set"}\nCurrent stage: ${call.current_stage}\nNotes:\n${stageNotes || "No stage notes captured."}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`LLM request failed with ${response.status}`);
  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("LLM returned no summary");
  return { model, summary };
}

app.post("/calls/:id/debrief", async (req, res) => {
  const callId = req.params.id;
  let call = supabase ? null : memoryCalls.find((item) => item.id === callId);
  if (supabase) {
    const { data, error } = await supabase.from("calls").select("*, stage_results(*)").eq("id", callId).single();
    if (error) return sendError(res, 404, "Call not found");
    call = data;
  }
  try {
    const debrief = await buildDebrief(call);
    if (supabase) {
      const { error } = await supabase.from("calls").update({ ai_summary: debrief.summary, ai_model: debrief.model }).eq("id", callId);
      if (error) return sendError(res, 502, error.message);
    } else {
      call.ai_summary = debrief.summary;
      call.ai_model = debrief.model;
    }
    res.json(debrief);
  } catch (error) {
    sendError(res, 502, error.message);
  }
});

app.get("/calls", async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("calls").select("*, stage_results(*)").order("started_at", { ascending: false });
    if (error) return sendError(res, 502, error.message);
    return res.json(data);
  }
  res.json(memoryCalls);
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Call Compass API listening on ${port}`));
