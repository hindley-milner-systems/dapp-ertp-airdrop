CHAINID=agoriclocal
USER1ADDR=$(agd keys show tg -a --keyring-backend="test")
ACCT_ADDR=$(USER1ADDR)
BLD=000000ubld

ATOM_DENOM=ibc/BA313C4A19DFBF943586C0387E6B11286F9E416B4DD27574E6909CABE0E342FA
ATOM=000000$(ATOM_DENOM)

.PHONY: list
# https://stackoverflow.com/a/73159833/7963
list:
	@make -npq : 2> /dev/null | grep -v PHONY |\
		awk -v RS= -F: '$$1 ~ /^[^#%]+$$/ { print $$1 }'

balance-q:
	agd keys show tg -a --keyring-backend="test"
	agd query bank balances $(ACCT_ADDR)

GAS_ADJUSTMENT=1.2
SIGN_BROADCAST_OPTS=--keyring-backend=test --chain-id=$(CHAINID) \
		--gas=auto --gas-adjustment=$(GAS_ADJUSTMENT) \
		--yes -b block

mint100:
	make FUNDS=1000$(ATOM) fund-acct
	cd /usr/src/agoric-sdk && \
		yarn --silent agops vaults open --wantMinted 100 --giveCollateral 100 >/tmp/want-ist.json && \
		yarn --silent agops perf satisfaction --executeOffer /tmp/want-ist.json --from tg --keyring-backend=test

# Keep mint4k around a while for compatibility
mint4k:
	make FUNDS=1000$(ATOM) fund-acct
	cd /usr/src/agoric-sdk && \
		yarn --silent agops vaults open --wantMinted 4000 --giveCollateral 1000 >/tmp/want4k.json && \
		yarn --silent agops perf satisfaction --executeOffer /tmp/want4k.json --from tg --keyring-backend=test

FUNDS=321$(BLD)
fund-acct:
	agd tx bank send validator $(ACCT_ADDR) $(FUNDS) \
	  $(SIGN_BROADCAST_OPTS) \
	  -o json >,tx.json
	jq '{code: .code, height: .height}' ,tx.json

gov-q:
	agd query gov proposals --output json | \
		jq -c '.proposals[] | [.proposal_id,.voting_end_time,.status]'

gov-voting-q:
	agd query gov proposals --status=voting_period --output json | \
		jq -c '.proposals[].proposal_id'

PROPOSAL=1
VOTE_OPTION=yes
vote:
	agd tx gov vote $(PROPOSAL) $(VOTE_OPTION) --from=validator \
	  $(SIGN_BROADCAST_OPTS) \
	  -o json >,tx.json
	jq '{code: .code, height: .height}' ,tx.json

instance-q:
	agd query vstorage data published.agoricNames.instance -o json

start-contract: check-contract-airdrop

API=http://localhost:1317
check-contract-airdrop: start-contract-airdrop
	@ curl -s $(API)/agoric/vstorage/data/published.agoricNames.instance \
	  | jq -c '.value | fromjson | .values[-1] | fromjson | .body[1:] | fromjson | .[]' \
	  | grep airdrop

start: make start-contract-airdrop start-contract

start-contract-airdrop:
	yarn node scripts/deploy-contract.js \
		--install src/airdrop.contract.js \
		--eval src/airdrop.proposal.js

start-contract-swap:
	yarn node scripts/deploy-contract.js \
		--install src/swaparoo.contract.js \
		--eval src/swaparoo.proposal.js

start-contract-pay:
	yarn node scripts/deploy-contract.js \
		--install src/postal-service.contract.js \
		--eval src/postal-service.proposal.js

# bundle-X.json.installed show that bundle-X.json was installed
# see also e2e-tools.js
%.json.installed: %.json
	@echo '{"up-to-date": false}'

# X.js.done shows that X.js core eval ran
%.js.done: %.js
	@echo '{"up-to-date": false}'

# Dependencies to re-run core eval when source changes
# NOTE: manually updated
bundles/deploy-airdrop.js: src/airdrop.proposal.js
	@echo '{"up-to-date": false}'

bundles/deploy-send.js: src/start-postalSvc.js
	@echo '{"up-to-date": false}'

bundles/deploy-swaparoo.js: src/swaparoo.proposal.js
	@echo '{"up-to-date": false}'

clean:
	@rm -rf bundles/
