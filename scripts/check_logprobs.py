"""One-off check: does the chosen model/provider return top logprobs?

Usage: python scripts/check_logprobs.py [model_id]
"""

import os
import sys

from huggingface_hub import InferenceClient

model = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("JUDGE_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
client = InferenceClient()

resp = client.chat_completion(
    model=model,
    messages=[
        {"role": "user", "content": 'One word — what emotion does this sentence express: "not sad"?'},
    ],
    max_tokens=1,
    logprobs=True,
    top_logprobs=20,
)

choice = resp.choices[0]
print(f"model: {model}")
print(f"generated: {choice.message.content!r}")
if choice.logprobs and choice.logprobs.content:
    for top in choice.logprobs.content[0].top_logprobs:
        print(f"  {top.token!r}: {top.logprob:.3f}")
else:
    print("NO LOGPROBS RETURNED — pick a different model/provider")
