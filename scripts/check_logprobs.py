"""One-off check: does the chosen model/provider return top logprobs?

Usage: python scripts/check_logprobs.py [model_id]
"""

import os
import sys

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()

model = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("JUDGE_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
client = InferenceClient()

resp = client.chat_completion(
    model=model,
    messages=[  # the judge's prompt: targets + few-shot turns, then "<sentence> is the same as"
        {"role": "system", "content": "The targets are: happy, sad, angry, scared."},
        {"role": "user", "content": "great! is the same as"},
        {"role": "assistant", "content": "happy"},
        {"role": "user", "content": "not sad is the same as"},
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
