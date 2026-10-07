import { refundCancelledEventOrders } from '../modules/refunds/refund.service';

export const refundCancelledEventsJob = () => refundCancelledEventOrders();