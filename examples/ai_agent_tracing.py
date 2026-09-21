"""AI Agent Tracing Demo for nahiarhdlog.

Demonstrates:
1. Automatic HTTP request/response body capture (prompts, completion JSON).
2. Tracing AI Agent execution steps using `ai_span` and `span`.
3. Nested child spans (embeddings, LLM reasoning, tool calls).
4. Viewing interactive waterfall traces in the embedded dashboard.

Run the demo:
    uv run python examples/ai_agent_tracing.py

Then open:
    http://127.0.0.1:8000/nahiarhdlog  (token: demo-token)
"""

import time
from fastapi import FastAPI
from pydantic import BaseModel

import nahiarhdLOG
from nahiarhdLOG import ai_span, span

app = FastAPI(title="AI Agent Proxy")
TOKEN = "demo-token"

# Observe app with body capture enabled
nahiarhdLOG.observe(app, dashboard_token=TOKEN, capture_body=True)


class PromptRequest(BaseModel):
    model: str = "gpt-4o"
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 500


@app.get("/api/v1/embedding/graph/{graph_id}")
def get_graph_embedding(graph_id: str):
    """Simulate graph vector embedding lookup."""
    with span("graph_vector_index", span_type="embedding", input_data={"graph_id": graph_id}) as s:
        time.sleep(0.08)  # simulate vector DB latency
        s.set_output({"dimensions": 1536, "nodes_matched": 12, "similarity": 0.94})
    return {"graph_id": graph_id, "status": "indexed", "nodes": 12}


@app.post("/api/proxy/v1/responses")
def generate_ai_response(req: PromptRequest):
    """Simulate multi-step AI Agent workflow."""
    # Step 1: Knowledge Retrieval / RAG
    with span("knowledge_retrieval", span_type="embedding", input_data={"query": req.prompt}) as rag:
        time.sleep(0.05)
        rag.set_output({"docs": ["fastapi_guide.md", "tracing_spec.md"]})

    # Step 2: Main Agent Execution with Tool Calling
    with ai_span(
        "agent_coordinator",
        model=req.model,
        messages=[{"role": "user", "content": req.prompt}],
        system_prompt="You are an autonomous coding assistant.",
        span_type="agent",
    ) as agent:

        # Step 2a: Tool execution
        with span("calculator_tool", span_type="tool", input_data={"operation": "2 * 21"}) as tool:
            time.sleep(0.04)
            tool.set_output({"result": 42})

        # Step 2b: Final LLM synthesis
        with ai_span("llm_synthesis", model=req.model, span_type="llm") as synth:
            time.sleep(0.12)
            completion_text = f"The answer to '{req.prompt}' computed via tools is 42."
            synth.set_completion(completion_text)
            synth.set_tokens(prompt_tokens=120, completion_tokens=45)

        agent.set_tool_calls([{"tool": "calculator_tool", "arguments": {"operation": "2 * 21"}}])
        agent.set_completion(completion_text)
        agent.set_tokens(prompt_tokens=150, completion_tokens=65)

    return {
        "model": req.model,
        "response": completion_text,
        "usage": {"prompt_tokens": 150, "completion_tokens": 65, "total_tokens": 215},
    }


if __name__ == "__main__":
    import json
    import threading
    import urllib.request
    import uvicorn

    def seed_initial_traces():
        time.sleep(1.0)
        try:
            # Seed graph embedding request
            urllib.request.urlopen("http://127.0.0.1:8000/api/v1/embedding/graph/e3993337-1f6d-4da7-acba-c63d08036113")
            # Seed AI proxy responses request
            post_req = urllib.request.Request(
                "http://127.0.0.1:8000/api/proxy/v1/responses",
                data=json.dumps({
                    "model": "gpt-4o",
                    "prompt": "What is the meaning of life times two?",
                    "temperature": 0.7,
                    "max_tokens": 500,
                }).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "ai/6.0.86 ai-sdk/provider-utils/4.0.51 runtime/node.js/22",
                },
                method="POST",
            )
            urllib.request.urlopen(post_req)
            print("\n✓ Seeded sample AI trace into live server")
        except Exception as err:
            print(f"Note: Automatic seed request returned: {err}")

    threading.Thread(target=seed_initial_traces, daemon=True).start()
    print("✓ Starting server at http://127.0.0.1:8000/nahiarhdlog/ (token: demo-token)\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
