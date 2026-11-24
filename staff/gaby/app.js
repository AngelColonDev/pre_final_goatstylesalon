window.AdminPortalConfig = {
    role: 'gabriel',
    mode: 'admin',
    title: 'Admin General',
    subtitle: 'Centro de operaciones de Goat Style Salon.'
};

const sharedScript = document.createElement('script');
sharedScript.src = '../shared-admin.js';
document.body.appendChild(sharedScript);
