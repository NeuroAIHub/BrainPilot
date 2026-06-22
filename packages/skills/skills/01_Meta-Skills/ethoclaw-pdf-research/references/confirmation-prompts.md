# Confirmation Prompts

When a PDF arrives, do not start parsing immediately unless the user explicitly asked for immediate analysis.

Use a short confirmation message like this:

## Default confirmation

I have received this PDF. How would you like me to handle it?
- Brief summary
- Detailed analysis
- Research log (direct reply to you)
- Focus on certain pages / sections / figures
- If you want, I can also organize it into a markdown file

I will start parsing after you confirm.

## If the file looks like a manual / SOP / guide

I have received this PDF, it looks like an operation manual/documentation. How would you like me to output it?
- Quick summary
- Organize by "usage-process-output-precautions"
- Direct reply as research log
- Organize as operation guide for newcomers
- If you want, I can also generate a markdown file

I will parse after you confirm.

## If the user already gave a goal

If the user says things like "help me summarize", "make a research log", "focus on methods section", that counts as confirmation. Start parsing directly and produce the requested output without asking again.
