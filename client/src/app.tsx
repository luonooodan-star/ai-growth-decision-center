/* eslint-disable @lark-apaas/require-app-container */
import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import GrowthDecisionPage from './pages/growth-decision/GrowthDecisionPage';
import ProductOverviewPage from './pages/growth-decision/ProductOverviewPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProductOverviewPage />} />
        <Route path="products/:productId" element={<GrowthDecisionPage />} />
      </Route>
      <Route path="*" element={<ProductOverviewPage />} />
    </Routes>
  );
};

export default RoutesComponent;
