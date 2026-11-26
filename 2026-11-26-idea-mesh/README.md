# IdeaMesh

> One prompt in, and the idea travels through the whole network on its own.

**Daily idea · 2026-11-26**

## The idea

IdeaMesh connects every step an idea goes through into one automated network. A single prompt sets it off:

- the idea pops up and is pushed to the ideas repo
- it is added to the portfolio, with the portfolio text generated for it
- later, it is also pushed to a folder on a public website

Each step is a brick that can be added, updated or upgraded on its own, so the whole thing grows like an ecosystem. Existing ideas, such as [PassRotor](../2026-09-10-passrotor/), become bricks in the network too.

## Why

- Today each step is done by hand, so ideas stall between the repo, the portfolio and the web.
- Small, swappable bricks are easier to improve one at a time than one big system.
- Ideas that feed into each other are worth more than ideas that sit alone.

## The prototype

A first prototype could be one script that takes a prompt, writes the idea folder to the repo and generates a matching portfolio entry, with each step as a separate, replaceable module.

## Status

🔴 **Idea.** Not built yet.

## Next steps

- [ ] Build a first prototype
- [ ] Map the bricks that already exist (repo, portfolio, PassRotor) and how they connect
- [ ] Define a simple interface every brick follows, so new ones can be plugged in
- [ ] Add the public website folder as a brick
