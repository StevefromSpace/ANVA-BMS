export const canOperate = (user) => user?.role === 'operator' || user?.role === 'admin';
export const isAdmin = (user) => user?.role === 'admin';
