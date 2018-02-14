.PHONY: test lint hash-dist

test:
	./node_modules/.bin/mocha --exit --ui bdd --reporter spec tests

lint:
	./node_modules/.bin/jshint ./

hash-dist:
	./hash-dist/run.sh
