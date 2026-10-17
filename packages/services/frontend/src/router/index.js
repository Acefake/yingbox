import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import DetailView from '../views/DetailView.vue'
import QueueView from '../views/QueueView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    path: '/video/:id',
    name: 'detail',
    component: DetailView,
    props: true,
  },
  {
    path: '/queue',
    name: 'queue',
    component: QueueView,
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
