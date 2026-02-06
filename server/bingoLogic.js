// server/bingoLogic.js - the math behind the wins

function isBingo(marked) {
  const n = marked.length;

  // checking rows to see if evrything is marked
  for (let i = 0; i < n; i++) {
    if (marked[i].every(Boolean)) return true;
  }

  
  // now check columns.. same logic basicly
  for (let j = 0; j < n; j++) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!marked[i][j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }

  // first diagonal line from top left
  let d1 = true;
  for (let i = 0; i < n; i++) {
    if (!marked[i][i]) {
      d1 = false;
      break;
    }
  }
  if (d1) return true;

  // other diagonal line from top right
  let d2 = true;
  for (let i = 0; i < n; i++) {
    if (!marked[i][n - 1 - i]) {
      d2 = false;
      break;
    }
  }
  if (d2) return true;

  return false;
}

module.exports = { isBingo };
