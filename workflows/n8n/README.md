# n8n integration (PERSON 3)
Local scaffold runs in direct FastAPI → mock partner mode so other members can develop independently.
This directory is NOT proof of an operational n8n integration. Before demo, implement and export a genuine n8n workflow: webhook receives dispatch → validates case → POSTs to partner API → reports partner job receipt to core → handles error/timeout.
Use production webhook rather than editor-only test webhook when deploying. Secure URLs and callbacks; never commit webhook secrets.
The backend must remain the source of truth, and partner acceptance must remain separate from job receipt.
