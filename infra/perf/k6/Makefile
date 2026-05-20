TARGET ?= http://localhost:4000

.PHONY: read checkout inventory

read:
	TARGET=$(TARGET) k6 run read-mix.js

checkout:
	TARGET=$(TARGET) CREDS=$${CREDS:-./creds.csv} k6 run checkout.js

inventory:
	TARGET=$(TARGET) SELLER_TOKENS=$${SELLER_TOKENS:-./seller-tokens.csv} k6 run inventory-burst.js

all: read checkout inventory
