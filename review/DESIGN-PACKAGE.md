# Design Package — shajithsasikumar

Tier 1, single journey. Written before generation. Consumed by the build.
Every line of copy here ships verbatim.

## 1. The brand premise

**Unbroken.** One continuous line from the moment someone reaches out to the
moment they are handled. Nothing drops, nothing is forgotten, and where the
line has to pass to a human, that hand off is designed rather than accidental.

The premise earns its place twice over. It is what Shajith sells (automation
that does not leak) and it is what his own record shows (a continuous line from
co founding a label at fifteen to Engineering Science and Ivey HBA at Western).
The hero is literally a single unbroken ribbon of light. Every section on the
page serves that one idea or it does not belong.

## 2. The palette as CSS tokens

Direction now, exact values sampled from the approved footage after the video
gate. Cold white light in deep tinted charcoal. Never pure black.

```css
:root{
  --canvas:#0B0D10;        /* deep charcoal, tinted cool toward the footage grade */
  --panel:#13171C;         /* raised surfaces */
  --accent:#9FD8FF;        /* ice blue: the CTA and rare emphasis only */
  --accent-hover:#C4E7FF;
  --accent-muted:#2A3946;  /* whisper level: borders, glows, particles */
  --text-secondary:#8A939D;
  --text-primary:#EEF2F6;
}
```

## 3. The type trio

- **Display: Sora**, weights 400 and 600. Geometric, technical, not a habitual
  default. Never Inter or Roboto as display.
- **Body: Instrument Sans**, weights 400 and 500. Quiet, gets out of the way.
- **Mono: JetBrains Mono**, weight 400. Small labels, dates, counts only.

## 4. The band map

Four bands over a 400vh hero. Ranges are starting points, validated by the
flick test. The action lane is the centre of frame, where the ribbon falls, so
every band sits in the negative space flanking it or below it.

| Band | Range | Footage moment | Copy (verbatim) | Entrance |
|---|---|---|---|---|
| 1 | 0.00 to 0.22 | The ribbon hangs, barely moving, high in frame | "Shajith Sasikumar" / "Engineering Science + Ivey HBA, Western University" | Drift down, echoing the ribbon about to fall |
| 2 | 0.26 to 0.50 | The ribbon accelerates down through the dark lattice | "I build systems that keep running after I leave." | Word by word rise, against the fall |
| 3 | 0.54 to 0.74 | The ribbon passes through the haze bank, light blooms | "Nothing dropped. Nothing forgotten." | Blur to sharp, echoing the haze clearing |
| 4 | 0.78 to 1.00 | The ribbon settles into its resting curve, light steadies | "And it knows when to hand you the phone." / CTA: "Book a call" | Word by word rise into a staged settle |

Band 1 skips the opacity ease in and gets the one time load ramp so the hero
opens with its words already assembled. Band 4 skips the ease out.

## 5. The static hero copy block

For phones and reduced motion, composed over the ending frame:

- Headline: "I build systems that keep running after I leave."
- Subline: "AI receptionists, voice agents and automation for small businesses. Engineering Science + Ivey HBA at Western University."
- CTA: "Book a call"

## 6. The below fold outline

Every section funnels to the single call to action anchor, `#book`.

1. **The problem, in their words.** "62 percent of calls to a small business go unanswered. 85 percent of those callers never ring back. They ring someone else." Then: "You do not have a lead problem. You have a pickup problem."
2. **What I build.** The six offers, each with its outcome. AI receptionist, voice agents, workflow automation, websites, brand identity, custom builds.
3. **The one interactive moment.** Press and hold to draw the line. The visitor holds, an unbroken line draws itself from "call comes in" through "answered", "booked", "logged", to "handed over". Completing it lights each stage in sequence. Releasing early eases back down, never snaps. Reduced motion gets the finished line with no hold. The visitor performs the premise instead of reading it.
4. **How it goes.** Four steps: Call, Scope, Build, Hand over. Genuinely a sequence, so genuinely numbered.
5. **The record.** Education, experience and leadership as one continuous list. The portfolio half of the site, and proof the line has been unbroken for years.
6. **Selected work.** Live from GitHub, newest first, with a skeleton and a real error state.
7. **FAQ.** Answering the objections the research actually found:
   - "Where does my customer data go?" Security is the number one concern buyers name.
   - "What does it cost to set up?" The second concern.
   - "Will it sound like a robot?" The honest answer: the voices are fine now, the real failure is an AI staying scripted through a moment that needed a person, which is why escalation rules get agreed before launch.
   - "What happens when it gets something wrong?"
   - "Do I own it?" Yes, it runs on your accounts.
8. **Book a call.** The single form. Name, email, what eats your week.
9. **Footer.** Contact, GitHub, LinkedIn, resume. The brand is real, so no fictional disclosure is needed.

## 7. The vector layer plan

- **The line motif**, drawn by hand in SVG, self drawing on scroll. It is the premise made visible and it recurs as the divider between every section, never as decoration but always as the same continuous line picked back up.
- **Whisper particles** in the fixed background layer, drifting at four seconds plus, cycling at 60 seconds or longer so the page reads as one environment.
- **The interactive line** in section 3, the one place the motif becomes something the visitor drives.
- Reduced motion shows every final drawn state and stops every drive.

## 8. The engineering list

The full standard from `scrub-pipeline.md`, named so the build cannot half
remember it: streamed Blob fetch behind the loading ring with the 20 second
watchdog, poster painted first, dt normalised lerp in a rAF loop that rests,
gated seeks with the error escape, delta gated DOM writes, band pacing
validated by the flick test, the four layer legibility system audited against
worst frames at 3.5:1 or better, the five static hero gates matched character
for character in CSS and JS and kept live with change listeners, complete
without video, and the whole site animated standard.

## 9. The copy gate

Every viewer facing line above ships verbatim. The built page must pass the
Phase 9 grep gate before anyone sees it: zero em dashes, zero stock words
(leverage, seamless, empower, unlock, robust, actionable, data driven,
solutions), plus the body copy sweep for AI tells. The designed staccato in
band 3 ("Nothing dropped. Nothing forgotten.") is a deliberate brand device
and stays.
