import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { MotionPlugin } from '@vueuse/motion';
import App from './App.vue';
import router from './router';
import './style.css';
import './styles/theme.css';
import './styles/motion.css';
import './styles/medical-bay-theme.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(MotionPlugin);

app.mount('#app');
