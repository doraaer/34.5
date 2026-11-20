# Integrate DORA voice in the tenant page

## Serve the module

FastAPI currently serves `frontend/static` at `/static`. Person 1 should copy
`agent/web/dora-voice.js` to `frontend/static/js/dora-voice.js` and use the
snippet below as written. There is no build step.

Alternatively, Person 3 can coordinate a static mount in `backend/main.py` with
`app.mount("/agent-web", StaticFiles(directory=ROOT / "agent" / "web"), name="agent-web")`.
Place it before the catch-all page route. With that mount, change the snippet
and example import to `/agent-web/dora-voice.js`.

The page should run on the same origin as FastAPI, using localhost or HTTPS for
microphone access. The browser loads the pinned SDK from jsDelivr. The public
ElevenLabs agent needs the five response-enabled client tools from
`agent/tools.json`. The SDK registers their handlers in the browser when the
session starts.

## Tenant markup

Replace the empty `#elevenlabs-agent-container` with this block and fill in
`data-agent-id` with the public agent ID. Remove the old pending-integration
copy and keep the text intake. Keep `tenant.js` as a classic script. Its
`refresh()` reads the page's in-memory `current` case, so the snippet updates
that binding after voice creates a case.

```html
<div id="elevenlabs-agent-container" data-agent-id="">
  <button type="button" data-talk>Start talking</button>
  <p role="status" data-voice-status>Voice is ready to start.</p>
  <p role="alert" data-voice-error></p>
  <h3>Transcript</h3>
  <ul data-transcript></ul>
  <h3>Tool events</h3>
  <ul data-tool-events></ul>
</div>
<script type="module">
  const panel = document.querySelector("#elevenlabs-agent-container");
  const button = panel.querySelector("[data-talk]");
  const statusLine = panel.querySelector("[data-voice-status]");
  const errorLine = panel.querySelector("[data-voice-error]");
  let voice;
  let connected = false;

  function append(selector, text, limit) {
    const list = panel.querySelector(selector);
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
    if (list.children.length > limit) list.firstElementChild.remove();
  }

  const options = {
    agentId: panel.dataset.agentId,
    onStatus: ({ status, mode }) => {
      connected = status === "connected";
      button.textContent = connected ? "Stop talking" : "Start talking";
      statusLine.textContent = {
        connecting: "Connecting to DORA...",
        connected: mode === "speaking" ? "DORA is speaking." : "Connected to DORA.",
        disconnecting: "Ending the conversation...",
        disconnected: "Voice session ended.",
      }[status] ?? status;
    },
    onMessage: ({ message, role, source }) => {
      const speaker = (role ?? source) === "user" ? "You" : "DORA";
      append("[data-transcript]", `${speaker}: ${message}`, 12);
    },
    onToolEvent: async ({ name, result }) => {
      append("[data-tool-events]", `${name}: ${result.ok ? (result.status ?? "OK") : result.error}`, 12);
      if (typeof refresh === "function") {
        // The current tenant.js stores its active case in a global lexical binding.
        if (name === "create_maintenance_case" && result.ok && typeof current !== "undefined") {
          current = result.case_id;
        }
        await refresh();
      }
    },
    onError: message => { errorLine.textContent = message; },
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    errorLine.textContent = "";
    try {
      if (!voice) {
        statusLine.textContent = "Loading DORA voice...";
        const { createDoraVoice } = await import("/static/js/dora-voice.js");
        voice = createDoraVoice(options);
        statusLine.textContent = "Voice is ready to start.";
      }
      if (connected) await voice.stop();
      else await voice.start();
    } catch {
      errorLine.textContent = "DORA voice couldn't load. Please try again or use the text form if available.";
      statusLine.textContent = "Voice is unavailable.";
    } finally {
      button.disabled = false;
    }
  });
</script>
```

## Standalone demo

For the copy setup, also copy `agent/web/voice-panel.example.html` to
`frontend/static/voice-panel.example.html`, set its `data-agent-id`, and open
`http://127.0.0.1:8000/static/voice-panel.example.html`. For the mount setup,
open `http://127.0.0.1:8000/agent-web/voice-panel.example.html` after changing
the example import as described above. The standalone panel has no dependency
on `common.js` or `tenant.js`.

Start talking, grant microphone access, report a heating issue, then approve an
offered window and consent to sharing the repair details. Check the tool log for
`awaiting_partner`. Accept an authorized slot in the mock partner dashboard,
then ask DORA for case status and check for `scheduled`. Use Stop talking to end
the session.

[ElevenLabs JavaScript SDK](https://elevenlabs.io/docs/eleven-agents/libraries/java-script)
