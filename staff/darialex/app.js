window.AdminPortalConfig = {
    role: 'darialex',
    mode: 'staff',
    title: 'Panel Darialex',
    subtitle: 'Gestión operativa para citas, clientes y publicaciones de Darialex.'
};

const sharedScript = document.createElement('script');
sharedScript.src = '../shared-admin.js';
document.body.appendChild(sharedScript);
