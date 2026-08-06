import List from './pages/List.js';
import Leaderboard from './pages/Leaderboard.js';
import Roulette from './pages/Roulette.js';
import Account from './pages/Account.js';
import Profile from './pages/Profile.js';
import Submit from './pages/Submit.js';
import Admin from './pages/Admin.js';

export default [
    { path: '/', component: List },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/roulette', component: Roulette },
    { path: '/account', component: Account },
    { path: '/players/:username', name: 'profile', component: Profile, props: true },
    { path: '/submit', component: Submit },
    { path: '/admin', component: Admin },
];
