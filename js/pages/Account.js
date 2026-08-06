import { api } from '../api.js';
import { store } from '../main.js';

const countries = [
    ['','Prefer not to say'], ['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['CA', 'Canada'], ['CL', 'Chile'], ['CN', 'China'], ['CO', 'Colombia'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IN', 'India'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IT', 'Italy'], ['JP', 'Japan'], ['KR', 'South Korea'], ['MX', 'Mexico'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NO', 'Norway'], ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['RU', 'Russia'], ['ES', 'Spain'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TR', 'Türkiye'], ['UA', 'Ukraine'], ['GB', 'United Kingdom'], ['US', 'United States'], ['VN', 'Vietnam'],
];

function flag(countryCode) {
    return countryCode
        ? String.fromCodePoint(...countryCode.toUpperCase().split('').map((letter) => 127397 + letter.charCodeAt(0)))
        : '';
}

export default {
    data: () => ({
        store,
        mode: 'login',
        busy: false,
        message: '',
        error: '',
        countries,
        login: { identifier: '', password: '' },
        register: { username: '', email: '', password: '' },
        profile: null,
    }),
    template: `
        <main class="account-page" :class="{ dark: store.dark }">
            <section class="account-panel" v-if="store.user">
                <div class="page-heading">
                    <p class="eyebrow">Your player card</p>
                    <h1>Profile settings</h1>
                    <p>Use the player identity field to automatically match approved list runs that use a different in-game name.</p>
                </div>
                <form v-if="profile" class="app-form" @submit.prevent="saveProfile">
                    <label>
                        <span>Display name</span>
                        <input v-model.trim="profile.displayName" maxlength="48" required>
                    </label>
                    <label>
                        <span>Verified player identity</span>
                        <input v-model.trim="profile.identityName" maxlength="48" required>
                        <small>Usually your Geometry Dash player name. Matching verified records are linked automatically.</small>
                    </label>
                    <label>
                        <span>Nationality</span>
                        <select v-model="profile.countryCode">
                            <option v-for="country in countries" :key="country[0]" :value="country[0]">{{ country[0] ? flag(country[0]) + ' ' : '' }}{{ country[1] }}</option>
                        </select>
                    </label>
                    <label>
                        <span>Bio</span>
                        <textarea v-model="profile.bio" maxlength="1000" rows="5" placeholder="Tell the list about yourself."></textarea>
                        <small>Bio is stored and shown as safe plain text; HTML is removed.</small>
                    </label>
                    <label>
                        <span>Featured completion</span>
                        <select v-model="profile.featuredCompletionId">
                            <option value="">No featured completion</option>
                            <option v-for="completion in profile.completions" :key="completion.id" :value="completion.id">#{{ completion.rank }} · {{ completion.progressPercent }}% {{ completion.levelName }}</option>
                        </select>
                    </label>
                    <p v-if="error" class="form-message error">{{ error }}</p>
                    <p v-if="message" class="form-message success">{{ message }}</p>
                    <div class="form-actions">
                        <button class="primary-button" :disabled="busy">{{ busy ? 'Saving…' : 'Save profile' }}</button>
                        <router-link class="text-button" :to="'/players/' + store.user.username">View public profile</router-link>
                    </div>
                </form>
            </section>
            <section v-else class="account-panel account-auth">
                <div class="page-heading">
                    <p class="eyebrow">TaCL account</p>
                    <h1>{{ mode === 'login' ? 'Welcome back' : 'Create your player profile' }}</h1>
                    <p>Sign in to submit levels or runs, build a public player card, and track review status.</p>
                </div>
                <div class="auth-tabs" role="tablist">
                    <button :class="{ active: mode === 'login' }" @click="mode = 'login'; error = ''">Sign in</button>
                    <button :class="{ active: mode === 'register' }" @click="mode = 'register'; error = ''">Register</button>
                </div>
                <form v-if="mode === 'login'" class="app-form" novalidate @submit.prevent="submitLogin">
                    <label><span>Username or email</span><input v-model.trim="login.identifier" autocomplete="username" required></label>
                    <label><span>Password</span><input v-model="login.password" type="password" autocomplete="current-password" minlength="10" required></label>
                    <p v-if="error" class="form-message error">{{ error }}</p>
                    <button class="primary-button" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
                </form>
                <form v-else class="app-form" novalidate @submit.prevent="submitRegistration">
                    <label><span>Username</span><input v-model.trim="register.username" autocomplete="username" pattern="[A-Za-z0-9_-]{3,32}" required><small>3–32 letters, numbers, underscores, or hyphens.</small></label>
                    <label><span>Email</span><input v-model.trim="register.email" type="email" autocomplete="email" required></label>
                    <label><span>Password</span><input v-model="register.password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><small>At least 10 characters.</small></label>
                    <p v-if="error" class="form-message error">{{ error }}</p>
                    <button class="primary-button" :disabled="busy">{{ busy ? 'Creating account…' : 'Create account' }}</button>
                </form>
            </section>
        </main>
    `,
    async mounted() {
        if (!store.sessionReady) {
            await store.refreshSession();
        }
        this.syncProfile();
    },
    watch: {
        'store.user': {
            handler() {
                this.syncProfile();
            },
            deep: true,
        },
    },
    methods: {
        flag,
        syncProfile() {
            if (store.user) {
                this.profile = {
                    ...store.user,
                    countryCode: store.user.countryCode || '',
                    featuredCompletionId: store.user.featuredCompletionId || '',
                    completions: [...(store.user.completions || [])],
                };
            }
        },
        async submitLogin() {
            this.busy = true;
            this.error = '';
            try {
                const { user } = await api.login(this.login);
                store.user = user;
                this.message = 'Signed in.';
            } catch (error) {
                this.error = error.message;
            } finally {
                this.busy = false;
            }
        },
        async submitRegistration() {
            this.busy = true;
            this.error = '';
            try {
                const { user } = await api.register(this.register);
                store.user = user;
                this.message = 'Account created.';
            } catch (error) {
                this.error = error.message;
            } finally {
                this.busy = false;
            }
        },
        async saveProfile() {
            this.busy = true;
            this.error = '';
            this.message = '';
            try {
                const { user } = await api.updateProfile(this.profile);
                store.user = user;
                this.profile = { ...user, countryCode: user.countryCode || '', featuredCompletionId: user.featuredCompletionId || '' };
                this.message = 'Profile saved and matching completions were linked.';
            } catch (error) {
                this.error = error.message;
            } finally {
                this.busy = false;
            }
        },
    },
};
