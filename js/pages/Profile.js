import { api } from '../api.js';

function flag(countryCode) {
    return countryCode
        ? String.fromCodePoint(...countryCode.toUpperCase().split('').map((letter) => 127397 + letter.charCodeAt(0)))
        : '';
}

export default {
    props: { username: { type: String, required: true } },
    data: () => ({ profile: null, error: '', loading: true }),
    template: `
        <main class="account-page" :class="{ dark: $root.store?.dark }">
            <section class="account-panel profile-card" v-if="!loading && profile">
                <div class="profile-hero">
                    <div class="profile-avatar" aria-hidden="true">{{ profile.displayName.slice(0, 1).toUpperCase() }}</div>
                    <div>
                        <p class="eyebrow">{{ profile.role }}</p>
                        <h1>{{ profile.displayName }}</h1>
                        <p class="muted">@{{ profile.username }} <span v-if="profile.countryCode">· {{ flag(profile.countryCode) }} {{ profile.countryCode }}</span></p>
                    </div>
                </div>
                <p class="profile-bio">{{ profile.bio || 'No bio yet.' }}</p>
                <section v-if="featured" class="featured-completion">
                    <p class="eyebrow">Featured completion</p>
                    <h2>#{{ featured.rank }} · {{ featured.progressPercent }}% {{ featured.levelName }}</h2>
                    <a :href="featured.proofUrl" target="_blank" rel="noopener noreferrer">Watch proof</a>
                </section>
                <section>
                    <h2>Verified completions</h2>
                    <table class="profile-completions" v-if="profile.completions.length">
                        <tr v-for="completion in profile.completions" :key="completion.id">
                            <td>#{{ completion.rank }}</td>
                            <td>{{ completion.progressPercent }}% {{ completion.levelName }}</td>
                            <td><a :href="completion.proofUrl" target="_blank" rel="noopener noreferrer">Proof</a></td>
                        </tr>
                    </table>
                    <p v-else class="muted">No verified completions yet.</p>
                </section>
            </section>
            <section v-else class="account-panel"><p v-if="loading">Loading profile…</p><p v-else class="form-message error">{{ error }}</p></section>
        </main>
    `,
    computed: {
        featured() {
            return this.profile?.completions.find((completion) => completion.id === this.profile.featuredCompletionId) || this.profile?.completions[0] || null;
        },
    },
    async mounted() {
        try {
            this.profile = (await api.getProfile(this.username)).profile;
        } catch (error) {
            this.error = error.message;
        } finally {
            this.loading = false;
        }
    },
    methods: { flag },
};
