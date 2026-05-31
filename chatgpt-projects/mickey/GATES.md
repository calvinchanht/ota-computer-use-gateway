# Mickey Validation Gates

Allowed validation calls:

- workspace_status / bootstrap / context snapshot
- read_file in Mickey workspace
- write_file/edit_file only in a safe scratch path
- safe run_command smoke tests such as `pwd`, `ls`, `node --version`, or writing to scratch
- batch API calls that combine the above
- get_run / retry / latest checkpoint tests

Stop before:

- raw secret disclosure
- OAuth/API/browser cookies or auth headers
- CAPTCHA/Turnstile/human verification
- payment, account creation, final submission, or external messages
- cross-workspace access

Evidence to collect:

- Does ChatGPT Project keep these files available across new chats?
- Can the API action be called without constant confirmations?
- Can routine safe calls run repeatedly?
- Can a batch call return reliably?
- Can a failed/stream-interrupted call be recovered by run_id?
- Does thread/session binding persist or need model-generated ids?
