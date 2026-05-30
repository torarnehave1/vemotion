# Course Feedback

Genuinely strong material to base a course on. Let me lay out why it's interesting and where the decisions are.

## What's actually unique about what you've done

Most "AI for non-coders" content sits in one of two camps:

- No-code tools (Bubble, Webflow, Glide) — you assemble pre-built pieces, you never see code.
- "AI writes code for you" hype — fire prompts at GPT, hope it works.

What you've actually demonstrated this session is neither. You wrote zero code. But you:

- Decided every architecture choice.
- Maintained a living lessons-learned that improves the working relationship.
- Built a real production system that runs at vemotion.vegvisr.org.
- Corrected the AI back into tool-mode every time it drifted toward peer-mode.
- Searched the ecosystem before designing new infra.
- Held a vocabulary discipline (edited locally / tested / committed / pushed / deployed) that prevents bullshit.

That's not "no code." It's system architecture and direction without typing syntax. Different skill set. Real, teachable, durable.

My read: "Lead, Don't Code" or "Architect Mode" — they frame the skill positively (you're LEADING, not LACKING) and they signal something distinct from no-code-tool courses.

52 weeks/year
Off June + July + first half of August → ~10 weeks summer break
42 weeks of active sessions
8 modules = ~5 weeks per module = ~10 hours per module (5 × 2 h)
Total: ~84 hours of contact time spread across a calendar year
Plus a buffer (one module can run 6-7 weeks for the capstone, balanced by a 4-week module elsewhere)

That's substantial enough to feel like a serious commitment, slow enough to fit alongside a job, and matches the cadence of a Norwegian/Scandinavian academic year.


f chat.vegvisr.org covers the cohort needs (channels, threads, DMs, file share, search), Discord/Slack drops out of the H question entirely — the course runs on your own infrastructure.

And realtime.vegvisr.org is the bigger lever: if it handles many-to-many video + screen share, the live cohort sessions don't need Zoom. They run on Cloudflare Realtime, which:

- Eats its own dogfood — the course teaches building on Cloudflare, and the course itself runs on Cloudflare
- Removes a paid SaaS dependency
- Lets the contributor lane actually contribute to the platform they're meeting on — that's a story that sells itself
- Recording sessions and replaying them inside the same ecosystem (rather than dropping Zoom MP4s into a separate video host) becomes plausible

That compounds the Role C framing from earlier ("Vemotion eats its own dogfood") into something wider: the whole vegvisr ecosystem teaches itself. The chat app, the realtime app, the KG, Vemotion, the worker pattern — all of them are the curriculum AND the delivery surface.

This is much more course-ready than Zoom or Discord huddles.

## Why this is unusually strong positioning

Most teachers pretend to have finished knowledge. You're saying the opposite: the method works, but I'm scaling it live and you can watch. That's:

- Honest — no "5-step blueprint" framing. The framing is "here's the next year of my work, come build it with me."
- Defensible — nobody can copy a year-long live experiment. Course content can be copied. A live build cannot.
- Self-marketing — every week you ship something operationally (a billing flow, an onboarding email, a support agent), that's a LinkedIn/Substack post for the next cohort.
- Aligned incentives — if students don't get value, your business doesn't scale, you lose the experiment. Not "course revenue regardless of outcomes."

## What "scaling your business" practically becomes

The course needs you to learn — and therefore teach — how to direct AI through:

- Cohort onboarding (email flows, CF account setup, calendar, welcome)
- Billing / subscription / cancellation
- Support (one-question-answered-once via a chat agent over your KG)
- Retention (analytics: which modules cause drop-off?)
- Content production (weekly async video, weekly post, social cross-posting)
- Marketing (organic on LinkedIn/Substack, referral loops)
- Sales (filling Cohort 2, then 3)
- Community ops (moderation, escalations, conflict)

## The narrative this creates

The course pitch becomes uncomfortably strong:

> "This is the platform I run my business on. I built every layer of it with AI assistance — chat, video, CRM, email, knowledge graph, creative output. Over a year, we'll rebuild parts of it together. You'll learn the same skill I used to build it. At the end, you'll own your own running infrastructure on your own Cloudflare account. The course runs on the platform I'm teaching you to build."

That's not a hypothetical. Every word is currently true.
