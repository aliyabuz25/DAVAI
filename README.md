# DAVAI — Free AI Study Platform for IB & IELTS Students

Built by David Salahov, 16, IB student at School 6, Baku, Azerbaijan.

## What is DAVAI?

DAVAI is a free AI-powered study platform for IB Diploma and IELTS students.
Two parts:
- Landing site (index.html) — introduces DAVAI, shows features, FAQ, podcasts
- Student app (davao_20_5/app.html) — AI chat, homework tracker, Word of the Day, videos, achievements

Free. No signup. No payment. Works in any browser on any device.

## How to run locally

    export ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE
    cd /Users/David/Desktop/DAVAIVSCODE
    python3 proxy.py
    open http://localhost:5050

Get your free API key at console.anthropic.com.
Set a monthly spending cap: console.anthropic.com > Settings > Billing > Usage limits.

## Security

- API key lives only in proxy.py on the server, never in frontend JS
- proxy.py binds to 127.0.0.1, only your Mac can reach it
- Rate limiting: 20 requests/hour, 50/day per IP, max 500 chars per message
- Only .html .css .js .json .png .svg .ico files are served publicly
- dotfiles, .py files, data/, uploads/, davao_20_5/server/ all return 403

## Academic integrity

DAVAI is a study coach, not a ghostwriter. The AI explains IB criteria,
gives feedback, and asks guiding questions. It never writes full essays.

## Tech stack

- Frontend: plain HTML, CSS, JavaScript, no frameworks, no npm
- Backend: Python 3 standard library only
- AI: Anthropic Claude via official api.anthropic.com
- Storage: browser localStorage, no server database
- PWA: manifest.json with real PNG icons

## Pages

- /                      index.html          Landing site
- /podcasts.html         podcasts.html       Study podcasts
- /privacy.html          privacy.html        Privacy policy
- /404.html              404.html            Branded 404
- /davao_20_5/app.html   app.html            Student app

## Contact

Email: davai.salahov@gmail.com
Instagram: @davai.tech
App launch: December 15, 2026
