import { api } from '../api.js';
import { store } from '../main.js';

export default {
    data: () => ({
        store,
        submissions: [],
        users: [],
        search: '',
        status: 'pending',
        loading: true,
        error: '',
        message: '',
        reviewNotes: {},
    }),
    template: `
        <main class="account-page admin-page" :class="{ dark: store.dark }">
            <section v-if="authorized" class="account-panel admin-panel">
                <div class="page-heading">
                    <p class="eyebrow">{{ store.user.role }} access</p>
                    <h1>Submission queue</h1>
                    <p>Approving a run creates a verified completion and immediately updates the public leaderboard. Approving a level makes it active on the list.</p>
                </div>
                <label class="compact-label">Show status
                    <select v-model="status" @change="loadSubmissions"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option></select>
                </label>
                <p v-if="error" class="form-message error">{{ error }}</p>
                <p v-if="message" class="form-message success">{{ message }}</p>
                <p v-if="loading">Loading queue…</p>
                <article v-for="submission in submissions" :key="submission.id" class="review-card">
                    <div class="review-title"><span class="status" :class="submission.status">{{ submission.status }}</span><h2>{{ submission.type === 'run' ? 'Run completion' : 'Level proposal' }}</h2></div>
                    <p class="muted">Submitted by <strong>{{ submission.submitter.displayName }}</strong> (@{{ submission.submitter.username }}) · {{ formatDate(submission.createdAt) }}</p>
                    <dl v-if="submission.type === 'run'" class="review-fields">
                        <template v-for="[key, value] in runFields(submission.payload)" :key="key"><dt>{{ key }}</dt><dd><a v-if="isLink(value)" :href="value" target="_blank" rel="noopener noreferrer">Open link</a><span v-else>{{ value || '—' }}</span></dd></template>
                    </dl>
                    <dl v-else class="review-fields">
                        <template v-for="[key, value] in levelFields(submission.payload)" :key="key"><dt>{{ key }}</dt><dd><a v-if="isLink(value)" :href="value" target="_blank" rel="noopener noreferrer">Open link</a><span v-else>{{ value || '—' }}</span></dd></template>
                    </dl>
                    <template v-if="submission.status === 'pending'">
                        <label><span>Review note <em>(optional)</em></span><textarea v-model="reviewNotes[submission.id]" rows="3" maxlength="1000" placeholder="Visible to the submitter."></textarea></label>
                        <div class="form-actions"><button class="primary-button" @click="review(submission.id, 'approved')">Approve</button><button class="danger-button" @click="review(submission.id, 'rejected')">Reject</button></div>
                    </template>
                    <p v-else-if="submission.reviewNotes" class="review-note"><strong>Review note:</strong> {{ submission.reviewNotes }}</p>
                </article>
                <p v-if="!loading && !submissions.length" class="muted">There are no submissions in this view.</p>
            </section>
            <section v-if="authorized && store.user.role === 'admin'" class="account-panel admin-panel">
                <div class="page-heading"><p class="eyebrow">Admin only</p><h2>User management</h2><p>Role changes take effect on the next request, even for an already-signed-in user.</p></div>
                <form class="user-search" @submit.prevent="findUsers"><input v-model.trim="search" type="search" placeholder="Username, display name, or email"><button class="text-button">Search</button></form>
                <table class="submission-table" v-if="users.length"><tr v-for="user in users" :key="user.id"><td><strong>{{ user.displayName || user.username }}</strong><br><span class="muted">@{{ user.username }} · {{ user.email }}</span></td><td><select :value="user.role" @change="setRole(user.id, $event.target.value)"><option value="user">User</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></td></tr></table>
            </section>
            <section v-if="!loading && !authorized" class="account-panel"><div class="page-heading"><p class="eyebrow">Restricted</p><h1>Moderator access required</h1><p>You do not have permission to view the review queue.</p></div></section>
        </main>
    `,
    computed: {
        authorized() {
            return ['admin', 'moderator'].includes(this.store.user?.role);
        },
    },
    async mounted() {
        if (!store.sessionReady) await store.refreshSession();
        if (this.authorized) await this.loadSubmissions();
        this.loading = false;
    },
    methods: {
        async loadSubmissions() {
            this.loading = true;
            this.error = '';
            try {
                this.submissions = (await api.getAdminSubmissions(this.status)).submissions;
            } catch (error) {
                this.error = error.message;
            } finally {
                this.loading = false;
            }
        },
        async review(id, decision) {
            this.error = '';
            this.message = '';
            try {
                await api.reviewSubmission(id, { decision, reviewNotes: this.reviewNotes[id] || '' });
                this.message = `Submission ${decision}.`;
                await this.loadSubmissions();
            } catch (error) {
                this.error = error.message;
            }
        },
        async findUsers() {
            try {
                this.users = (await api.findUsers(this.search)).users;
            } catch (error) {
                this.error = error.message;
            }
        },
        async setRole(id, role) {
            try {
                await api.updateRole(id, role);
                this.message = 'Role updated.';
                await this.findUsers();
            } catch (error) {
                this.error = error.message;
                await this.findUsers();
            }
        },
        formatDate(value) { return new Date(value).toLocaleString(); },
        isLink(value) { return typeof value === 'string' && /^https?:\/\//.test(value); },
        runFields(payload) { return [['Level ID', payload.levelId], ['Progress', `${payload.progressPercent}%`], ['Video proof', payload.videoProofUrl], ['Raw footage', payload.rawFootageUrl], ['Notes', payload.notes]]; },
        levelFields(payload) { return [['Level name', payload.levelName], ['GD ID', payload.gdId], ['Creator', payload.creatorName], ['Song', payload.songReference], ['Video proof', payload.videoProofUrl], ['Notes', payload.notes]]; },
    },
};
