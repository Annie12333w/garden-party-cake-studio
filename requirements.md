# Final Project Requirements and Rubric

Source: https://zlisto.github.io/mgt_409_fa26/project_requirements.html (paraphrased 2026-10-20).

**Due:** Monday, October 26, 2026, 6:00 PM, on Canvas. **Solo project.**

**Goal:** build an AI agent app that does something useful for real people. Show how it works, what it costs, and how you kept it safe.

## Submit on Canvas
- [ ] **GitHub repo link:** all the app code, a README with run instructions, and a `.env.example` with no real keys. The repo must be public, or private with **zlisto** added as a collaborator.
- [ ] **`report.html`:** self-contained, 10–15 printed pages.
- [ ] **`slides.html`:** self-contained reveal.js deck, 10 slides max.
- [ ] *(Optional)* a 2–3 minute demo video recorded on your machine.
- Both HTML files must open with a double-click, with all images embedded.

## Report sections (in order)
1. **Title and links:** project name, your name, repo link, app link if online, and a one-sentence description.
2. **Motivation:** who has the problem and what it costs them today (money, time, frustration).
3. **What is new:** the existing alternatives and how this project differs.
4. **The agents:** each agent's role and tools, how they are organized (with a diagram), the model choice, and one step-by-step run with screenshots.
5. **Tokenomics:**
   - *measured* input, cached and output tokens per run
   - cost per run, per user per month, and at 100 and 10,000 users
   - what was done to cut cost, and any performance trade-offs
6. **Safety:** the relevant risks (prompt injection, agent malfunction, overspending), the defenses built, and **at least one defense shown working**.
7. **Impact:** benefits in numbers, with sources. The strongest evidence is a **real user trying the app**.
8. **Limits and next steps.**

## Slides (suggested order)
Title, problem, what's new, agent diagram, demo screenshots, cost, safety, impact numbers, next steps.

## Models and keys
- **Course key** `PORTKEY_API_KEY` works **only with `gpt-6-luna`**.
- Any other model needs your own paid key, named `OPENAI_API_KEY` for OpenAI.
- Never commit a real `.env` or key.
- The app must look for `.env` **in its own folder first, then one level up** (staff keys sit in the parent folder).
- Only those two key names are supported. Any other key means the app must be hosted online, after checking with the professor.

## Running the app
- Either host it online and keep it live until grades are posted, or make it run locally from a fresh clone by following the README.
- If the real dataset is large, include a small test dataset and explain how to switch between them in the README.
- **10-minute rule:** if the app doesn't run within 10 minutes of following the README, the "staff can run it" criterion scores 0.

## Grading (100 points)
| Component | Points | Sub-criteria |
|---|---|---|
| Idea | 21 | Novelty and real-world value (21) |
| App | 30 | Works (15); staff can run it (5); look and feel (10) |
| Report | 41 | Motivation and what's new (8); agent design (10); tokenomics (8); safety (8); impact and metrics (5); design (2) |
| Slides | 8 | Content (6); design (2) |

**Evidence rule:** a report section without its evidence earns **at most half** of that row's points. A description alone counts as no evidence. Evidence means:
- measured token counts
- screenshots of the defenses working
- feedback from real users

## Tiers
- **Tier 1 (baseline):** the app works, but the idea is familiar and the report skips details.
- **Tier 2:** a new or clever idea, thoughtful agent design, and a complete report with measured costs, a real safety defense and screenshots of it working.
- **Tier 3:** everything in Tier 2, plus:
  - a clever idea that clearly improves things for real people
  - user evidence
  - time or quality measured against how people do it today
  - cost thinking at the organization level

## Overdone ideas (capped at Tier 1 on the idea score unless there is a real new twist)
- resume reviewers
- chat-with-documents
- travel planners
- email or meeting summarizers
- recipe planners
- generic study tools
- anything built in class or the homeworks without a real addition

## Tips
- Start with one specific person's problem, and talk to real users.
- Screenshot good runs, bad runs and safety catches as you go.
- Ship a working app before adding complexity.
