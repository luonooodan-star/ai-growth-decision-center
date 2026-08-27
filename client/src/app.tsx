import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import GrowthDecisionPage from './pages/growth-decision/GrowthDecisionPage';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<GrowthDecisionPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
