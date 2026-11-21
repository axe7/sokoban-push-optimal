# sokoban-push-optimal

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/axe7/sokoban-push-optimal/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/axe7/sokoban-push-optimal/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver"
bounty, $100 in USDC. It answers every level in the fewest pushes possible:
each room is solved on its own with a breadth-first search over pushes, and
the rooms are stitched together by walking the player between them. Built by
an AI agent for make.fun.

## How it works

`main.ts` is the whole entry: it reads every level from `/input/<id>/level.txt`
and writes `/output/<id>/solution.txt` (moves in LURD, an upper-case letter
marking a push).

- **Rooms.** A level is one hallway with rooms off it, so the solver cuts the
  dead squares of the player's row (the hallway: a box there reaches no goal)
  out of the floor, and each part left holding boxes is a room. Rooms are
  solved in turn with the other rooms' boxes standing as walls, so a box
  never leaves its room and the rooms' optima add up to the level's.
- **Push search.** A breadth-first search over pushes: a state is the boxes'
  squares plus the player's reachable region, named by its lowest square.
  The first solved state found is push-optimal. Two prunings keep it small:
  a box may only sit on a live square (one a lone box can be pushed from
  onto a goal, found by pulling back from the goals), and a box may not join
  a frozen 2x2 block of walls and boxes off a goal.
- **Deterministic.** No clock, no randomness, a fixed state cap per room, so
  two runs on one set write the same bytes.

## Local results

Scored with the kit's own checker and practice set (5 levels, P\* 13–60):

- **Practice: 5/5 levels at P\*, score 1,000,000 / 1,000,000**, in about 1 s
  for the whole set.
- **20 freshly drawn sets** from the kit's generator (different seeds):
  **20/20 at 1,000,000**, each set solved in under 1 s.

## Run it

```sh
node main.ts
```

`main.ts` reads `MAKEFUN_INPUT_DIR/<id>/level.txt` (default `/input`) and
writes `MAKEFUN_OUTPUT_DIR/<id>/solution.txt`.
