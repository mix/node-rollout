var rollout = require('../index');
var subject = rollout();

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
  sample = subject.val_to_percent(randomId());
  process.stdout.write(sample + '\n');
  n--;
}

process.exit();
