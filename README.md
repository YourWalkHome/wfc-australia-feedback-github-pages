# WFC Australia Compass MVP

This repository hosts the WFC Australia website and the secure Compass MVP backend.

The preview is intended for a small trusted review panel. It is not the final public WFC Australia website.

## Recommended Hosting

Use Vercel for this version.

GitHub Pages can still show static pages, but it cannot securely run the Compass AI backend or hold private API keys. Vercel can serve the same website and run the secure `/api` functions.

## Compass Backend

- `/api/compass` handles dynamic Compass replies and structured summary generation.
- `/api/handover` handles the reviewed handover to Ben Ryan.
- The visitor's conversation is remembered in browser session storage during the visit.
- No AI key is exposed in the browser.
- If email sending is not configured, the handover endpoint returns an email draft link.

See `VERCEL-COMPASS-MVP-STEPS.txt` for setup steps.

## Review Focus

- Does the site feel calm, clear, and trustworthy?
- Does "Understand clearly. Decide confidently. Move forward responsibly." land well?
- Does The Off-Ramp concept feel useful without being overused?
- Are the practical business outcomes visible enough?
- Does the site show what clarity enables: better decisions, stronger alignment, and responsible progress?
- Is the Ben + Compass section practical enough without becoming AI hype?
- Does the site feel practical without becoming salesy?
- Do visitors understand who Ben Ryan is and why his role matters?
- Do visitors understand who Compass is and what role it plays?
- Does the Ben + Compass relationship feel transparent, trustworthy, and useful?
- Does the API-powered Compass Start a Conversation page help a business owner feel heard, respected, and better prepared?
- Does Compass feel like a bridge to Ben Ryan rather than a barrier?
- Does Compass ask thoughtful follow-up questions without becoming long, heavy, or directive?
- Does the editable handover summary feel useful without becoming advice, diagnosis, or analysis?
- Is it clear that nothing is sent automatically and the visitor controls what is shared?
- Does the secure backend approach feel appropriate for a real WFC Ben + Compass bridge?
- What feels unclear, too soft, too heavy, or missing?

The goal is not a perfect website yet. The goal is a trusted first conversation.
