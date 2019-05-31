var Rollouts = require('../index');

var subject = new Rollouts({
  redisClientFactory() { throw new Error('Redis is not needed here') }
});

function randomString(length) {
  var resultChars = [];
  var possibleChars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var randomIndex;

  for (var i = 0; i < length; i++) {
    randomIndex = Math.floor(Math.random() * possibleChars.length);
    resultChars.push(possibleChars.charAt(randomIndex));
  }

  return resultChars.join('');
}

function randomId() {
  var randomLength = 10 + Math.floor(Math.random() * 20);
  return randomString(randomLength);
}

var n = 100000;
var sample
while (n) {
  sample = subject.likelihood(randomId());
  process.stdout.write(sample + '\n');
  n--;
}

process.exit();
