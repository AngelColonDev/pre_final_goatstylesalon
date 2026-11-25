window.AdminPortalConfig = {
    role: 'wilo',
    mode: 'staff',
    title: 'Panel Wilo',
    subtitle: 'Gestión operativa para citas, clientes y publicaciones de Wilo.'
};

const sharedScript = document.createElement('script');
sharedScript.src = '../shared-admin.js?v=20261124f';
document.body.appendChild(sharedScript);
