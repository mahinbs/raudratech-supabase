// Clickable table rows (links inside the row still work normally).
document.querySelectorAll('tr.rowlink').forEach(function (tr) {
  tr.addEventListener('click', function (e) {
    if (e.target.closest('a, button, input, form')) return;
    window.location = tr.dataset.href;
  });
});
