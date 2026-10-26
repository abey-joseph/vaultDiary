/** Opens the print dialog showing only the recovery sheet (see @media print in styles.css). */
export function printRecoverySheet() {
  document.body.classList.add('printing-sheet')
  const done = () => {
    document.body.classList.remove('printing-sheet')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
  setTimeout(done, 1000)
}
