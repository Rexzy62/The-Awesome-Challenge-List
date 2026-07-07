import routes from './routes.js';
import { SITE_VERSION } from './site-meta.js';
import { getStoredDarkMode, setStoredDarkMode } from './theme.js';

export const store = Vue.reactive({
    dark: getStoredDarkMode(),
    toggleDark() {
        this.dark = !this.dark;
        setStoredDarkMode(this.dark);
    },
});

const app = Vue.createApp({
    data: () => ({
        siteVersion: SITE_VERSION,
        store,
    }),
});
const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes,
});

app.use(router);

app.mount('#app');
