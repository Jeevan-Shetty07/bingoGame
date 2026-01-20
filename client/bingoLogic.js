// client/bingoLogic.js

function isBingo(marked) {
  const n = marked.length;

  // rows
  for (let i = 0; i < n; i++) {
    if (marked[i].every(Boolean)) return true;
  }

  // cols
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

  // diag 1
  let d1 = true;
  for (let i = 0; i < n; i++) {
    if (!marked[i][i]) {
      d1 = false;
      break;
    }
  }
  if (d1) return true;

  // diag 2
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
