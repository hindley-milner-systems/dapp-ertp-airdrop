# syntax=docker/dockerfile:1.4

## RESUME
FROM ghcr.io/agoric/agoric-3-proposals:use-upgrade-17 as use-use-upgrade-17

#----------------
# tribbles
#----------------

# EVAL tribbles
FROM use-use-upgrade-17 as eval-tribbles

COPY --link --chmod=755 ./proposals/a:tribbles /usr/src/proposals/a:tribbles

WORKDIR /usr/src/upgrade-test-scripts

# First stage of this proposal so install its deps.
COPY --link ./upgrade-test-scripts/install_deps.sh /usr/src/upgrade-test-scripts/
RUN --mount=type=cache,target=/root/.yarn ./install_deps.sh a:tribbles

COPY --link --chmod=755 ./upgrade-test-scripts/*eval* /usr/src/upgrade-test-scripts/
SHELL ["/bin/bash", "-c"]
RUN ./run_eval.sh a:tribbles


# USE tribbles
FROM eval-tribbles as use-tribbles

WORKDIR /usr/src/upgrade-test-scripts

COPY --link --chmod=755 ./upgrade-test-scripts/run_use.sh ./upgrade-test-scripts/start_agd.sh /usr/src/upgrade-test-scripts/
SHELL ["/bin/bash", "-c"]
RUN ./run_use.sh a:tribbles
ENTRYPOINT ./start_agd.sh


# TEST tribbles
FROM use-tribbles as test-tribbles

WORKDIR /usr/src/upgrade-test-scripts

COPY --link --chmod=755 ./upgrade-test-scripts/run_test.sh /usr/src/upgrade-test-scripts/
SHELL ["/bin/bash", "-c"]
ENTRYPOINT ./run_test.sh a:tribbles
