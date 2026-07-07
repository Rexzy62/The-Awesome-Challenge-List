import { store } from "../main.js";
import { embed } from "../util.js";
import { score } from "../score.js";
import { fetchEditors, fetchList } from "../content.js";
import { SUBMISSION_RULES } from "../site-meta.js";

import Spinner from "../components/Spinner.js";
import LevelAuthors from "../components/List/LevelAuthors.js";

const roleIconMap = {
    owner: "crown",
    admin: "user-gear",
    helper: "user-shield",
    dev: "code",
    trial: "user-lock",
};
const mainListLimit = 75;
const extendedListLimit = 150;

export default {
    components: { Spinner, LevelAuthors },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-list">
            <div class="list-container">
                <form class="filters" @submit.prevent>
                    <label>
                        <span class="type-label-md">Search</span>
                        <input
                            v-model.trim="search"
                            type="search"
                            placeholder="Level, creator, verifier, ID"
                            aria-label="Search levels"
                        >
                    </label>
                    <label>
                        <span class="type-label-md">Rank</span>
                        <select v-model="rankFilter" aria-label="Filter by rank range">
                            <option value="all">All levels</option>
                            <option value="main">Main list</option>
                            <option value="extended">Extended list</option>
                            <option value="legacy">Legacy</option>
                        </select>
                    </label>
                    <p class="type-label-md">{{ filteredList.length }} of {{ list.length }} shown</p>
                </form>
                <table class="list" v-if="filteredList.length > 0">
                    <tr v-for="item in filteredList" :key="item.path || item.index">
                        <td class="rank">
                            <p v-if="item.index + 1 <= extendedListLimit" class="type-label-lg">#{{ item.index + 1 }}</p>
                            <p v-else class="type-label-lg">Legacy</p>
                        </td>
                        <td class="level" :class="{ 'active': selected == item.index, 'error': !item.level }">
                            <button @click="selectLevel(item.index)" :disabled="!item.level">
                                <span class="type-label-lg">{{ item.level?.name || \`Error (\${item.err}.json)\` }}</span>
                            </button>
                        </td>
                    </tr>
                </table>
                <p class="no-results" v-else>No levels match this filter.</p>
            </div>
            <div class="level-container">
                <div class="level" v-if="level">
                    <h1>{{ level.name }}</h1>
                    <LevelAuthors :author="level.author" :creators="level.creators" :verifier="level.verifier"></LevelAuthors>
                    <div class="video-actions" v-if="hasShowcase">
                        <button
                            type="button"
                            :class="{ active: videoMode === 'verification' }"
                            @click="videoMode = 'verification'"
                        >
                            Verification
                        </button>
                        <button
                            type="button"
                            :class="{ active: videoMode === 'showcase' }"
                            @click="videoMode = 'showcase'"
                        >
                            Showcase
                        </button>
                    </div>
                    <iframe
                        v-if="video"
                        class="video"
                        id="videoframe"
                        :src="video"
                        :title="\`\${level.name} \${videoMode} video\`"
                        allowfullscreen
                    ></iframe>
                    <div v-else class="video-placeholder">
                        <p>Verification video coming soon.</p>
                    </div>
                    <ul class="stats">
                        <li>
                            <div class="type-title-sm">Points when completed</div>
                            <p>{{ score(selected + 1, 100, level.percentToQualify) }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">ID</div>
                            <p>{{ level.id }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">Password</div>
                            <p>{{ level.password || 'Free to Copy' }}</p>
                        </li>
                    </ul>
                    <h2>Records</h2>
                    <p v-if="selected + 1 <= mainListLimit"><strong>{{ level.percentToQualify }}%</strong> or better to qualify</p>
                    <p v-else-if="selected + 1 <= extendedListLimit"><strong>100%</strong> or better to qualify</p>
                    <p v-else>This level does not accept new records.</p>
                    <table class="records" v-if="level.records.length > 0">
                        <tr v-for="record in level.records" class="record">
                            <td class="percent">
                                <p>{{ record.percent }}%</p>
                            </td>
                            <td class="user">
                                <a :href="record.link" target="_blank" rel="noopener noreferrer" class="type-label-lg">{{ record.user }}</a>
                            </td>
                            <td class="mobile">
                                <img v-if="record.mobile" :src="\`/assets/phone-landscape\${store.dark ? '-dark' : ''}.svg\`" alt="Mobile">
                            </td>
                            <td class="hz">
                                <p>{{ record.hz }}Hz</p>
                            </td>
                        </tr>
                    </table>
                    <p v-else>No accepted records yet.</p>
                </div>
                <div v-else class="level" style="height: 100%; justify-content: center; align-items: center;">
                    <p>(ノಠ益ಠ)ノ彡┻━┻</p>
                </div>
            </div>
            <div class="meta-container">
                <div class="meta">
                    <div class="errors" v-show="errors.length > 0">
                        <p class="error" v-for="error of errors">{{ error }}</p>
                    </div>
                    <div class="og">
                        <p class="type-label-md">Website layout made by <a href="https://tsl.pages.dev/" target="_blank" rel="noopener noreferrer">TheShittyList</a></p>
                    </div>
                    <template v-if="editors">
                        <h3>List Editors</h3>
                        <ol class="editors">
                            <li v-for="editor in editors">
                                <img :src="\`/assets/\${roleIcon(editor.role)}\${store.dark ? '-dark' : ''}.svg\`" :alt="\`\${editor.role} role\`">
                                <a v-if="editor.link" class="type-label-lg link" target="_blank" rel="noopener noreferrer" :href="editor.link">{{ editor.name }}</a>
                                <p v-else>{{ editor.name }}</p>
                            </li>
                        </ol>
                    </template>
                    <h3>Submission Requirements</h3>
                    <p>
                        Achieved the record without using hacks (however, FPS bypass is allowed, up to {{ submissionRules.fpsLimit }}fps)
                    </p>
                    <p>
                        Achieved the record on the level that is listed on the site - please check the level ID before you submit a record
                    </p>
                    <p>
                        Have either source audio or clicks/taps in the video.
                    </p>
                    <p>
                        The recording must have a previous attempt and entire death animation shown before the completion, unless the completion is on the first attempt. Everyplay records are exempt from this
                    </p>
                    <p>
                        The recording must also show the player hit the endwall and show the FULL Level Completion Screen, or the completion will be invalidated.
                    </p>
                    <p>
                        Do not use secret routes or bug routes
                    </p>
                    <p>
                        Do not use easy modes, only a record of the unmodified level qualifies
                    </p>
                    <p>
                        Once a level falls onto the Legacy List, we accept records for it for {{ submissionRules.legacyGraceHours }} hours after it falls off, then afterwards we never accept records for said level
                    </p>
                </div>
            </div>
        </main>
    `,
    data: () => ({
        list: [],
        editors: [],
        loading: true,
        selected: 0,
        search: "",
        rankFilter: "all",
        videoMode: "verification",
        errors: [],
        mainListLimit,
        extendedListLimit,
        roleIconMap,
        submissionRules: SUBMISSION_RULES,
        store
    }),
    computed: {
        level() {
            return this.list[this.selected]?.[0] || null;
        },
        filteredList() {
            const query = this.search.toLowerCase();

            return this.list
                .map(([level, err], index) => ({ level, err, index, path: level?.path || err }))
                .filter(({ level, err, index }) => {
                    const rank = index + 1;
                    const matchesRank = this.rankFilter === "all"
                        || (this.rankFilter === "main" && rank <= mainListLimit)
                        || (this.rankFilter === "extended" && rank > mainListLimit && rank <= extendedListLimit)
                        || (this.rankFilter === "legacy" && rank > extendedListLimit);

                    if (!matchesRank) {
                        return false;
                    }

                    if (!query) {
                        return true;
                    }

                    if (!level) {
                        return err.toLowerCase().includes(query);
                    }

                    return [
                        level.name,
                        level.id,
                        level.author,
                        level.verifier,
                        ...(level.creators || []),
                    ].some((value) => String(value).toLowerCase().includes(query));
                });
        },
        hasShowcase() {
            return Boolean(this.level?.showcase);
        },
        video() {
            return embed(this.videoMode === "showcase" && this.hasShowcase
                ? this.level.showcase
                : this.level?.verification);
        },
    },
    async mounted() {
        // Hide loading spinner
        const list = await fetchList();
        this.list = list || [];
        this.editors = await fetchEditors();

        // Error handling
        if (!list) {
            this.errors = [
                "Failed to load list. Retry in a few minutes or notify list staff.",
            ];
        } else {
            this.errors.push(
                ...this.list
                    .filter(([_, err]) => err)
                    .map(([_, err]) => {
                        return `Failed to load level. (${err}.json)`;
                    })
            );
            if (!this.editors) {
                this.errors.push("Failed to load list editors.");
            }
        }

        this.loading = false;
    },
    methods: {
        embed,
        score,
        selectLevel(index) {
            this.selected = index;
            this.videoMode = "verification";
        },
        roleIcon(role) {
            return roleIconMap[role] || roleIconMap.helper;
        },
    },
};
