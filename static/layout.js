(function() {
    const btn = document.getElementById('sidebar-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    });
})();