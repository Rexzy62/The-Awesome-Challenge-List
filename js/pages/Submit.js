import { api } from '../api.js';
import { store } from '../main.js';

export default {
    data: () => ({
        store,
        mode: 'run',
        levels: [],
        submissions: [],
        loading: true,
        busy: false,
        message: '',
        error: '',
        levelForm: { levelName: '', gdId: '', creatorName: '', songReference: '', videoProofUrl: '', notes: '' },
        runForm: { levelId: '', videoProofUrl: '', progressPercent: 100, rawFootageUrl: '', notes: '' },
    }),
    template: `
        <main class="account-page" :class="{ dark: store.dark }">
            <section class="account-panel submission-panel" v-if="store.user">
                <div class="page-heading">
                    <p class="eyebrow">On-site review</p>
                    <h1>Submit to the list</h1>
                    <p>All submissions are private until a moderator approves or rejects them. Keep original footage available for review.</p>
                </div>
                <div class="auth-tabs" role="tablist">
                    <button :class="{ active: mode === 'run' }" @click="mode = 'run'; clearMessage()">Run completion</button>
                    <button :class="{ active: mode === 'level' }" @click="mode = 'level'; clearMessage()">New level</button>
                </div>
                <form v-if="mode === 'run'" class="app-form" @submit.prevent="submitRun">
                    <label>
                        <span>Level</span>
                        <select v-model="runForm.levelId" required>
                            <option disabled value="">Select an active list level</option>
                            <option v-for="level in levels" :key="level.internalId" :value="level.internalId">#{{ level.rank }} · {{ level.name }}</option>
                        </select>
                    </label>
                    <label><span>Video proof URL</span><input v-model.trim="runForm.videoProofUrl" type="url" placeholder="YouTube or Twitch URL" required></label>
                    <label><span>Progress percentage</span><input v-model.number="runForm.progressPercent" type="number" min="1" max="100" required></label>
                    <label><span>Raw footage link <em>(optional)</em></span><input v-model.trim="runForm.rawFootageUrl" type="url" placeholder="Uncut recording or drive link"></label>
                    <label><span>Notes <em>(optional)</em></span><textarea v-model.trim="runForm.notes" rows="4" maxlength="2000" placeholder="Platform, refresh rate, or anything reviewers should know."></textarea></label>
                    <p v-if="error" class="form-message error">{{ error }}</p>
                    <p v-if="message" class="form-message success">{{ message }}</p>
                    <button class="primary-button" :disabled="busy || loading">{{ busy ? 'Sending…' : 'Submit run for review' }}</button>
                </form>
                <form v-else class="app-form" @submit.prevent="submitLevel">
                    <label><span>Level name</span><input v-model.trim="levelForm.levelName" maxlength="100" required></label>
                    <label><span>GD ID</span><input v-model.trim="levelForm.gdId" inputmode="numeric" pattern="[0-9]+" required></label>
                    <label><span>Creator name</span><input v-model.trim="levelForm.creatorName" maxlength="64" required></label>
                    <label><span>Song ID or link</span><input v-model.trim="levelForm.songReference" maxlength="2048" required></label>
                    <label><span>Video proof URL</span><input v-model.trim="levelForm.videoProofUrl" type="url" placeholder="YouTube or Twitch URL" required></label>
                    <label><span>Description / notes <em>(optional)</em></span><textarea v-model.trim="levelForm.notes" rows="5" maxlength="2000" placeholder="Context, placement suggestion, or relevant level information."></textarea></label>
                    <p v-if="error" class="form-message error">{{ error }}</p>
                    <p v-if="message" class="form-message success">{{ message }}</p>
                    <button class="primary-button" :disabled="busy">{{ busy ? 'Sending…' : 'Submit level for review' }}</button>
                </form>
            </section>
            <section class="account-panel submission-panel" v-if="store.user && submissions.length">
                <h2>Your recent submissions</h2>
                <table class="submission-table">
                    <tr v-for="submission in submissions" :key="submission.id">
                        <td><strong>{{ submission.type === 'run' ? 'Run' : 'Level' }}</strong><br><span class="muted">{{ titleFor(submission) }}</span></td>
                        <td><span class="status" :class="submission.status">{{ submission.status }}</span></td>
                        <td>{{ submission.reviewNotes || 'Awaiting review' }}</td>
                    </tr>
                </table>
            </section>
            <section v-if="!store.user && store.sessionReady" class="account-panel">
                <div class="page-heading"><p class="eyebrow">Account required</p><h1>Ready to submit?</h1><p>Create a profile first, then submit a level or run directly to the review queue.</p></div>
                <router-link class="primary-button" to="/account">Sign in or register</router-link>
            </section>
            <section v-else-if="!store.user" class="account-panel"><p>Loading account…</p></section>
        </main>
    `,
    async mounted() {
        if (!store.sessionReady) await store.refreshSession();
        if (!store.user) return;
        try {
            const [levelResponse, submissionResponse] = await Promise.all([api.getLevels(), api.getSubmissions()]);
            this.levels = levelResponse.levels;
            this.submissions = submissionResponse.submissions;
        } catch (error) {
            this.error = error.message;
        } finally {
            this.loading = false;
        }
    },
    methods: {
        clearMessage() { this.error = ''; this.message = ''; },
        titleFor(submission) {
            return submission.type === 'run'
                ? `${submission.payload.progressPercent}% completion`
                : submission.payload.levelName;
        },
        async submitRun() {
            this.busy = true;
            this.clearMessage();
            try {
                await api.submitRun(this.runForm);
                this.message = 'Run submitted. It is now pending moderator review.';
                this.runForm = { levelId: '', videoProofUrl: '', progressPercent: 100, rawFootageUrl: '', notes: '' };
                this.submissions = (await api.getSubmissions()).submissions;
            } catch (error) {
                this.error = error.message;
            } finally {
                this.busy = false;
            }
        },
        async submitLevel() {
            this.busy = true;
            this.clearMessage();
            try {
                await api.submitLevel(this.levelForm);
                this.message = 'Level submitted. It is now pending moderator review.';
                this.levelForm = { levelName: '', gdId: '', creatorName: '', songReference: '', videoProofUrl: '', notes: '' };
                this.submissions = (await api.getSubmissions()).submissions;
            } catch (error) {
                this.error = error.message;
            } finally {
                this.busy = false;
            }
        },
    },
};
