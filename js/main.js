import routes from './routes.js';
import { SITE_VERSION } from './site-meta.js';
import { getStoredDarkMode, setStoredDarkMode } from './theme.js';
import { api } from './api.js';

export const store = Vue.reactive({
    dark: getStoredDarkMode(),
    user: null,
    sessionReady: false,
    toggleDark() {
        this.dark = !this.dark;
        setStoredDarkMode(this.dark);
    },
    async refreshSession() {
        try {
            this.user = (await api.getSession()).user;
        } catch {
            this.user = null;
        } finally {
            this.sessionReady = true;
        }
    },
    async signOut() {
        await api.logout();
        this.user = null;
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
store.refreshSession();
